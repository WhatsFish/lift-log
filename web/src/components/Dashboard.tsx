"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type Action, type Exercise, type Session, type Settings, type State, benchmarkSchema,
  emptyState, exerciseIds, exercises, sessionSchema, settingsSchema } from "@/lib/model";
import { type Readiness, chronological, e1rm, isStrength, makePlan, strengthSummary } from "@/lib/engine";
import { type Draft, DRAFT_KEY, draftSchema, localDateTime } from "@/lib/draft";
import { Disclaimer } from "./Disclaimer";

type Tab = "today" | "progress" | "history" | "settings";
const dateLabel = (at: string) => new Date(at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const errorText = (error: unknown) => error instanceof Error ? error.message : "发生未知错误，请重试";
const round = (value: number) => Math.round(value * 10) / 10;

export function Dashboard() {
  const [state, setState] = useState<State>(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const [readiness, setReadiness] = useState<Readiness>("good");
  const [pain, setPain] = useState(false);
  const [kind, setKind] = useState<"auto" | "A" | "B">("auto");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(new Date());
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<Exercise>("squat");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/lift-log/api/state", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/lift-log/login"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "无法加载数据");
      setState(body); setLoaded(true);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    void load();
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = draftSchema.safeParse(JSON.parse(saved));
        if (!parsed.success) throw new Error("本地草稿格式不兼容，请先导出浏览器存储或联系维护者。");
        setDraft(parsed.data);
      }
    } catch (e) { setError(errorText(e)); }
    setDraftReady(true);
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(clock); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [load]);
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch { setError("浏览器无法保存草稿，请勿关闭页面；完成后务必保存到服务器。"); }
  }, [draft, draftReady]);

  const plan = useMemo(() => makePlan(state, {
    now, readiness, pain, kind: kind === "auto" ? undefined : kind,
  }), [state, readiness, pain, kind, now]);

  async function send(action: Action) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/lift-log/api/state", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
      });
      if (response.status === 401) { window.location.assign("/lift-log/login"); return false; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "保存失败");
      setState(body); setLoaded(true); setNotice("已保存到服务器");
      return true;
    } catch (e) { setError(errorText(e)); return false; }
    finally { setBusy(false); }
  }
  function clearDraft() {
    setDraft(null);
    try { localStorage.removeItem(DRAFT_KEY); }
    catch { setError("无法清除浏览器草稿，请在浏览器设置中移除该站点数据。"); }
  }
  function start() {
    if (plan.blocked || !loaded || draft) return;
    setNotice(""); setRestUntil(null);
    setDraft({
      id: crypto.randomUUID(), kind: plan.kind, startedAt: new Date().toISOString(),
      exercises: plan.exercises.map(e => ({
        exercise: e.exercise, min: e.min, max: e.max,
        rows: Array.from({ length: e.sets }, () => ({
          weight: e.weight === null ? "" : String(e.weight), reps: String(e.min), rir: String(e.rir), done: false,
        })),
      })),
      cardio: "incline", cardioMinutes: "0", duration: String(state.settings.minutes),
      effort: "6", note: "",
    });
    setTab("today");
  }
  async function finish() {
    if (!draft) return;
    const result = sessionSchema.safeParse({
      id: draft.id, at: draft.startedAt, kind: draft.kind,
      sets: draft.exercises.flatMap(e => e.rows.filter(r => r.done).map(r => ({
        exercise: e.exercise, weight: Number(r.weight), reps: Number(r.reps), rir: Number(r.rir),
      }))),
      duration: Number(draft.duration), cardio: Number(draft.cardioMinutes) > 0 ? draft.cardio : "none",
      cardioMinutes: Number(draft.cardioMinutes), effort: Number(draft.effort), note: draft.note,
    });
    if (!result.success) { setError(result.error.issues.map(i => i.message).join("；")); return; }
    const pending = draft.exercises.flatMap(e => e.rows).filter(r => !r.done).length;
    if (pending && !window.confirm(`还有 ${pending} 组未完成。只保存已勾选的工作组并结束训练？`)) return;
    if (await send({ type: "session", revision: state.revision, value: result.data })) {
      clearDraft(); setRestUntil(null); setKind("auto"); setTab("history");
    }
  }
  function updateRow(exerciseIndex: number, rowIndex: number, field: "weight" | "reps" | "rir" | "done", value: string | boolean) {
    setDraft(current => current ? {
      ...current, exercises: current.exercises.map((e, i) => i !== exerciseIndex ? e : {
        ...e, rows: e.rows.map((r, j) => j !== rowIndex ? r : { ...r, [field]: value }),
      }),
    } : null);
    if (field === "done" && value) setRestUntil(Date.now() + 180_000);
  }
  const summary = strengthSummary(state, selectedExercise, now);
  const totalSets = state.sessions.reduce((sum, s) => sum + s.sets.length, 0);
  const rest = restUntil ? Math.max(0, Math.ceil((restUntil - now.getTime()) / 1000)) : null;
  const volume = state.sessions.reduce((sum, s) => sum + s.sets.reduce((v, r) => v + r.weight * r.reps, 0), 0);

  return <main className="shell">
    <header className="topbar"><a href="/lift-log" className="brand"><span className="brand-mark">L</span> LIFT LOG</a>
      <button className="text-button" disabled={busy} onClick={async () => {
        if (draft && !window.confirm("本机有未完成的训练草稿，退出不会删除。确认退出？")) return;
        setBusy(true);
        try {
          const response = await fetch("/lift-log/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          if (!response.ok && response.status !== 401) throw new Error("退出失败，请重试");
          window.location.assign("/lift-log/login");
        } catch (e) { setError(errorText(e)); setBusy(false); }
      }}>退出登录</button></header>
    <div aria-live="polite">
      {!online && <div className="alert">当前离线：训练草稿保存在本机，联网后才能完成服务器打卡。请勿清除浏览器数据。</div>}
      {error && <div className="alert error" role="alert">{error}<button onClick={() => void load()} disabled={busy}>加载最新数据</button></div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
    </div>
    {!loaded ? <section className="card"><h1>{busy ? "正在加载训练日志…" : "训练数据尚未加载"}</h1>
      <p>不会用空数据覆盖你的训练记录。</p><button disabled={busy} onClick={() => void load()}>重新连接</button></section> : <>
      {tab === "today" && !draft && <>
        <section className="hero">
          <p className="eyebrow">TRAIN WHEN YOU CAN</p><h1>不等周一，<br />今天也可以开始。</h1>
          <p>计划跟着你的力量和恢复走，不跟着日历走。</p>
          <div className="stats">
            <div><strong>{plan.strengthCount}<small> / 2</small></strong><span>近 7 天力量</span></div>
            <div><strong>{plan.boxingCount}<small> / 1</small></strong><span>近 7 天搏击</span></div>
            <div><strong>{plan.gap === null ? "—" : plan.gap}<small> 天</small></strong><span>距上次力量</span></div>
          </div>
        </section>
        {!state.benchmarks.length && !state.sessions.length && <section className="callout">
          <h2>先校准，不必测试极限</h2><p>在「力量」录入已知的重量 × 次数和剩余次数。旧纪录请填真实日期，系统会保守减量。没有数据的动作先热身，手动选轻重量。</p>
          <button className="secondary" onClick={() => setTab("progress")}>录入当前力量</button>
        </section>}
        <section className="card">
          <div className="section-title"><h2>下一次 · 全身 {plan.kind}</h2><span className="tag">{plan.returning ? "恢复适应期" : "双重进阶"}</span></div>
          <div className="two-col">
            <label>今天的状态<select value={readiness} onChange={e => setReadiness(e.target.value as Readiness)}>
              <option value="good">正常，恢复良好</option><option value="tired">有些累 / 睡眠不足</option><option value="poor">明显疲劳</option>
            </select></label>
            <label>训练顺序<select value={kind} onChange={e => setKind(e.target.value as "auto" | "A" | "B")}>
              <option value="auto">自动轮换（推荐）</option><option value="A">改练 A</option><option value="B">改练 B</option>
            </select></label>
          </div>
          <label className="checkline"><input type="checkbox" checked={pain} onChange={e => setPain(e.target.checked)} />今天存在影响动作的疼痛</label>
          <div className="exercise-list">{plan.exercises.map(e => <div className="exercise-preview" key={e.exercise}>
            <div><h3>{exercises[e.exercise].name}{e.light && <small> · 轻量</small>}</h3>
              <p>{e.sets} 组 × {e.min}–{e.max} 次 · 保留 {e.rir} 次</p>
              {e.reasons.map(reason => <p className="hint" key={reason}>{reason}</p>)}</div>
            <strong>{e.weight ?? "待校准"}{e.weight !== null && <small> kg</small>}</strong>
          </div>)}</div>
          <p className="muted">先热身 5–8 分钟，大动作逐级热身；工作组间休息 2–3 分钟。之后轻松爬坡 {plan.cardioMinutes} 分钟，以能完整说话为准。时间不够时缩短有氧，不赶重组。</p>
          <details><summary>为什么这样安排？</summary>{plan.reasons.map(r => <p key={r}>{r}</p>)}
            <p>采用同重量工作组，不是极限单次或强制加重。完成全部目标组、达到次数上限且仍保留至少 2 次才增加最小重量；当天减量优先。</p></details>
          {plan.blocked && <div className="alert">{plan.reasons.find(r => r.includes("暂停") || r.includes("不足 24"))}</div>}
          <button className="primary wide" onClick={start} disabled={busy || plan.blocked}>开始这次训练</button>
        </section>
        <CardioForm revision={state.revision} busy={busy} send={send} />
      </>}
      {tab === "today" && draft && <>
        <section className="hero compact"><p className="eyebrow">IN SESSION · {draft.kind}</p><h1>专注这一组。</h1>
          <p>只勾选实际完成的组。草稿留在本机，点击结束才计入进展。</p>
          <div className="section-title"><span>{draft.exercises.flatMap(e => e.rows).filter(r => r.done).length} / {draft.exercises.flatMap(e => e.rows).length} 组完成</span>
            {rest !== null && <button className="timer" onClick={() => setRestUntil(Date.now() + 180_000)}>休息 {Math.floor(rest / 60)}:{String(rest % 60).padStart(2, "0")} ↻</button>}</div>
          {Date.now() - Date.parse(draft.startedAt) > 86_400_000 && <p className="alert">这是超过一天的旧草稿。确认日期后保存，或放弃后开始新训练；不会自动改成今天。</p>}
        </section>
        {draft.exercises.map((e, ei) => <section className="card" key={e.exercise}>
          <div className="section-title"><h2>{exercises[e.exercise].name}</h2><span className="tag">{e.min}–{e.max} 次 / 组</span></div>
          <div className="set-grid set-head"><span>组</span><span>重量 kg</span><span>次数</span><span>剩余次数</span><span>完成</span></div>
          {e.rows.map((r, ri) => <div className={`set-grid ${r.done ? "completed" : ""}`} key={ri}>
            <span>{ri + 1}</span>
            <input aria-label={`${exercises[e.exercise].name} 第${ri + 1}组重量`} inputMode="decimal" type="number" min=".5" max="500" step=".5" value={r.weight} onChange={event => updateRow(ei, ri, "weight", event.target.value)} />
            <input aria-label={`${exercises[e.exercise].name} 第${ri + 1}组次数`} inputMode="numeric" type="number" min="1" max="30" value={r.reps} onChange={event => updateRow(ei, ri, "reps", event.target.value)} />
            <select aria-label={`${exercises[e.exercise].name} 第${ri + 1}组剩余次数`} value={r.rir} onChange={event => updateRow(ei, ri, "rir", event.target.value)}>
              {[0, 1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n === 5 ? "5+" : n}</option>)}
            </select>
            <input aria-label={`${exercises[e.exercise].name} 第${ri + 1}组完成`} type="checkbox" checked={r.done} onChange={event => updateRow(ei, ri, "done", event.target.checked)} />
          </div>)}
        </section>)}
        <section className="card"><h2>完成本次训练</h2><p className="muted">只填实际完成的有氧时长；没做填 0。整体强度 1 = 轻松，10 = 极限。</p>
          <div className="two-col">
            <label>有氧类型<select value={draft.cardio} onChange={e => setDraft({ ...draft, cardio: e.target.value as Draft["cardio"] })}>
              <option value="incline">爬坡走</option><option value="stairs">爬梯</option><option value="none">无</option>
            </select></label>
            <label>有氧分钟<input type="number" min="0" max="120" value={draft.cardioMinutes} onChange={e => setDraft({ ...draft, cardioMinutes: e.target.value })} /></label>
            <label>总分钟（含有氧）<input type="number" min="1" max="240" value={draft.duration} onChange={e => setDraft({ ...draft, duration: e.target.value })} /></label>
            <label>整体强度 1–10<input type="number" min="1" max="10" value={draft.effort} onChange={e => setDraft({ ...draft, effort: e.target.value })} /></label>
          </div>
          <label>备注<textarea maxLength={1000} placeholder="睡眠、动作感受、器械变化…" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
          <button className="primary wide" disabled={busy || !online} onClick={() => void finish()}>{busy ? "保存中…" : "结束训练并打卡"}</button>
          <button className="text-button danger" disabled={busy} onClick={() => { if (window.confirm("放弃这次未保存的训练草稿？")) clearDraft(); }}>放弃草稿</button>
        </section>
      </>}
      {tab === "progress" && <>
        <div className="page-title"><p className="eyebrow">STRENGTH, NOT JUST NUMBERS</p><h1>看见力量回来。</h1><p>历史最好和近期水平分开看，减脂期维持力量也算进步。</p></div>
        <div className="metric-grid">
          <div className="card metric"><strong>{state.sessions.filter(isStrength).length}</strong><span>累计力量训练</span></div>
          <div className="card metric"><strong>{totalSets}</strong><span>完成工作组</span></div>
          <div className="card metric"><strong>{round(volume / 1000)}</strong><span>累计训练吨位 t</span></div>
        </div>
        <section className="card"><label>动作<select value={selectedExercise} onChange={e => setSelectedExercise(e.target.value as Exercise)}>{exerciseIds.map(id => <option key={id} value={id}>{exercises[id].name}</option>)}</select></label>
          <div className="stats light"><div><strong>{summary.current ?? "—"}<small> kg</small></strong><span>近期参考 e1RM</span></div>
            <div><strong>{summary.pr ?? "—"}<small> kg</small></strong><span>历史估算 PR</span></div></div>
          <Trend points={summary.points} />
          <p className="muted">{summary.age === null ? "录入评估或完成训练后，这里会显示力量趋势。" : `最新样本距今 ${summary.age} 天。${summary.age >= 14 ? "数据已陈旧；训练处方会额外减量，此数值不代表今天的能力。" : ""}`}</p>
          <p className="hint">Epley 估算：重量 × [1 + (次数 + RIR) / 30]；真正 1 次极限用原重量。仅取 ≤10 次、RIR≤3 的组。近期参考为最近评估之后、最新样本前 42 天内最后 3 个训练 / 评估样本的中位数，不是测得的 1RM。</p>
        </section>
        <section className="card"><h2>力量目标</h2><p className="muted">目标单位为估算 1RM kg，不是今天的工作重量；不设必须完成的日期。</p>
          {exerciseIds.filter(id => state.settings.goals[id]).map(id => {
            const target = state.settings.goals[id]!;
            const current = strengthSummary(state, id, now).current;
            return <div className="goal" key={id}><div className="section-title"><strong>{exercises[id].name}</strong><span>{current ?? "—"} / {target} kg</span></div>
              <progress max={target} value={Math.min(current ?? 0, target)} aria-label={`${exercises[id].name}目标进度`} /></div>;
          })}
          {!Object.keys(state.settings.goals).length && <p>还没有设目标。可以先观察两三次训练，再设定现实的方向。</p>}
          <button className="secondary" onClick={() => setTab("settings")}>编辑目标</button>
        </section>
        <BenchmarkForm revision={state.revision} busy={busy} send={send} />
      </>}
      {tab === "history" && <>
        <div className="page-title"><p className="eyebrow">EVERY SESSION COUNTS</p><h1>每一次，都算数。</h1><p>这里只显示已保存到服务器的训练和评估。</p></div>
        <button className="secondary" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = `lift-log-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
        }}>导出全部记录 JSON</button>
        {!state.sessions.length && !state.benchmarks.length && <section className="card"><h2>从第一条记录开始</h2><p>不要求固定星期几；有时间、恢复好，就开始下一次。</p></section>}
        {chronological(state.sessions).reverse().map(s => <section className="card" key={s.id}>
          <div className="section-title"><h2>{isStrength(s) ? `全身 ${s.kind}` : s.kind === "boxing" ? "有氧搏击" : "稳态有氧"}</h2><span className="tag">{s.duration} 分钟</span></div>
          <p className="muted">{dateLabel(s.at)} · 整体强度 {s.effort}/10</p>
          {exerciseIds.map(id => {
            const sets = s.sets.filter(r => r.exercise === id);
            return sets.length > 0 && <p key={id}><strong>{exercises[id].name}</strong><br /><span className="muted">{sets.map(r => `${r.weight} kg × ${r.reps}（余 ${r.rir}）`).join(" · ")}</span></p>;
          })}
          {s.cardioMinutes > 0 && <p>{({ none: "无", incline: "爬坡", stairs: "爬梯", boxing: "搏击" })[s.cardio]} {s.cardioMinutes} 分钟</p>}
          {s.note && <p className="note">{s.note}</p>}
          <button className="text-button danger" disabled={busy} onClick={() => {
            if (window.confirm("删除这次训练？力量趋势和下一次计划会重新计算。")) void send({ type: "delete", revision: state.revision, collection: "sessions", id: s.id });
          }}>删除误记</button>
        </section>)}
        {state.benchmarks.length > 0 && <h2 className="subheading">力量评估记录</h2>}
        {chronological(state.benchmarks).reverse().map(b => <section className="card" key={b.id}>
          <div className="section-title"><h3>{exercises[b.exercise].name}</h3><span className="tag">评估</span></div>
          <p>{b.weight} kg × {b.reps} · 保留 {b.rir} 次 · e1RM {e1rm(b.weight, b.reps, b.rir)} kg</p>
          <p className="muted">{dateLabel(b.at)}</p>
          <button className="text-button danger" disabled={busy} onClick={() => {
            if (window.confirm("删除这条力量评估？")) void send({ type: "delete", revision: state.revision, collection: "benchmarks", id: b.id });
          }}>删除误记</button>
        </section>)}
      </>}
      {tab === "settings" && <SettingsForm key={state.revision} state={state} busy={busy} send={send} />}
    </>}
    <Disclaimer />
    <nav className="bottom-nav" aria-label="主导航">
      {([["today", draft ? "训练中" : "今日"], ["progress", "力量"], ["history", "记录"], ["settings", "设置"]] as const).map(([id, label]) =>
        <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          <span className="nav-dot" />{label}
        </button>)}
    </nav>
  </main>;
}

type FormProps = { revision: number; busy: boolean; send: (action: Action) => Promise<boolean> };
function BenchmarkForm({ revision, busy, send }: FormProps) {
  const [id, setId] = useState(() => crypto.randomUUID());
  const [exercise, setExercise] = useState<Exercise>("squat");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("5");
  const [rir, setRir] = useState("2");
  const [at, setAt] = useState(localDateTime);
  const [error, setError] = useState("");
  return <section className="card"><h2>校准力量 · 重量 × 次数</h2><p className="muted">可输入已知的极限次数（RIR = 0），也可输入留有余力的一组。不要为了填表去尝试危险极限。</p>
    <form onSubmit={async event => {
      event.preventDefault(); setError("");
      const parsed = benchmarkSchema.safeParse({
        id, exercise, weight: Number(weight), reps: Number(reps), rir: Number(rir),
        at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : "",
      });
      if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join("；")); return; }
      if (await send({ type: "benchmark", revision, value: parsed.data })) { setWeight(""); setId(crypto.randomUUID()); }
    }}>
      <label>动作<select value={exercise} onChange={e => setExercise(e.target.value as Exercise)}>{exerciseIds.map(id => <option key={id} value={id}>{exercises[id].name}</option>)}</select></label>
      <div className="two-col"><label>重量 kg<input required inputMode="decimal" type="number" min=".5" max="500" step=".5" value={weight} onChange={e => setWeight(e.target.value)} /></label>
        <label>完成次数（1–10）<input required inputMode="numeric" type="number" min="1" max="10" value={reps} onChange={e => setReps(e.target.value)} /></label>
        <label>剩余次数 RIR<select value={rir} onChange={e => setRir(e.target.value)}>{[0, 1, 2, 3].map(n => <option key={n} value={n}>{n === 0 ? "0 · 已知极限" : `${n} · 还能做 ${n} 次`}</option>)}</select></label>
        <label>实际完成时间<input required type="datetime-local" value={at} max={localDateTime()} onChange={e => setAt(e.target.value)} /></label></div>
      {Number(weight) > 0 && <p className="estimate">估算 1RM ≈ {e1rm(Number(weight), Number(reps), Number(rir))} kg</p>}
      {error && <p className="alert error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>保存力量评估</button>
    </form>
  </section>;
}

function CardioForm({ revision, busy, send }: FormProps) {
  const [id, setId] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"boxing" | "cardio">("boxing");
  const [cardio, setCardio] = useState<"incline" | "stairs">("incline");
  const [duration, setDuration] = useState("30");
  const [effort, setEffort] = useState("7");
  const [at, setAt] = useState(localDateTime);
  const [error, setError] = useState("");
  return <section className="card"><div className="section-title"><h2>今天只练有氧？</h2><span className="tag">随时打卡</span></div>
    <p className="muted">搏击可优先周二，但不锁日期。每 7 天约一次高强度即可；力量后爬坡保持能完整说话的强度。</p>
    <button className="secondary" onClick={() => setOpen(!open)}>{open ? "收起" : "记录搏击 / 有氧"}</button>
    {open && <form onSubmit={async event => {
      event.preventDefault(); setError("");
      const parsed = sessionSchema.safeParse({
        id, at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : "",
        kind, sets: [], duration: Number(duration), cardio: kind === "boxing" ? "boxing" : cardio,
        cardioMinutes: Number(duration), effort: Number(effort), note: "",
      });
      if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join("；")); return; }
      if (await send({ type: "session", revision, value: parsed.data })) { setOpen(false); setId(crypto.randomUUID()); }
    }}>
      <div className="two-col"><label>训练类型<select value={kind} onChange={e => setKind(e.target.value as "boxing" | "cardio")}><option value="boxing">有氧搏击 / HIIT</option><option value="cardio">稳态有氧</option></select></label>
        {kind === "cardio" && <label>方式<select value={cardio} onChange={e => setCardio(e.target.value as "incline" | "stairs")}><option value="incline">爬坡走</option><option value="stairs">爬梯</option></select></label>}
        <label>分钟<input required type="number" min="1" max="120" value={duration} onChange={e => setDuration(e.target.value)} /></label>
        <label>整体强度 1–10<input required type="number" min="1" max="10" value={effort} onChange={e => setEffort(e.target.value)} /></label>
        <label>实际训练时间<input required type="datetime-local" value={at} max={localDateTime()} onChange={e => setAt(e.target.value)} /></label></div>
      {error && <p className="alert error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>保存有氧打卡</button>
    </form>}
  </section>;
}

function SettingsForm({ state, busy, send }: { state: State; busy: boolean; send: FormProps["send"] }) {
  const [settings, setSettings] = useState<Settings>(state.settings);
  const [lastAt, setLastAt] = useState(state.settings.lastTrainingAt ? localDateTime(new Date(state.settings.lastTrainingAt)) : "");
  const [error, setError] = useState("");
  return <><div className="page-title"><p className="eyebrow">YOUR PLAN, YOUR PACE</p><h1>按你的节奏。</h1></div>
    <form className="card" onSubmit={async event => {
      event.preventDefault(); setError("");
      const parsed = settingsSchema.safeParse({ ...settings, lastTrainingAt: lastAt ? new Date(lastAt).toISOString() : null });
      if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join("；")); return; }
      await send({ type: "settings", revision: state.revision, value: parsed.data });
    }}>
      <h2>训练偏好</h2><div className="two-col">
        <label>当前阶段<select value={settings.mode} onChange={e => setSettings({ ...settings, mode: e.target.value as Settings["mode"] })}><option value="cut">减脂：优先保留力量</option><option value="maintain">维持：渐进提升</option></select></label>
        <label>每次可用时间<select value={settings.minutes} onChange={e => setSettings({ ...settings, minutes: Number(e.target.value) as Settings["minutes"] })}><option value="45">45 分钟 · 精简组数</option><option value="60">60 分钟 · 标准</option><option value="75">75 分钟 · 从容休息</option></select></label>
      </div>
      <label>开始使用前，最后一次力量训练时间（可留空）
        <input type="datetime-local" max={localDateTime()} value={lastAt} onChange={e => setLastAt(e.target.value)} /></label>
      <p className="hint">仅在还没有训练打卡时使用；不确定就留空，默认从保守的恢复适应期开始。输入新的力量评估不会抹掉停训间隔。</p>
      <h2 className="subheading">目标与最小加重</h2><p className="muted">杠铃记录总重量（含杆）；划船和下拉固定同一台器械，器械重量不能跨型号比较。目标只是方向，不会强迫系统加重。</p>
      {exerciseIds.map(id => <div className="settings-row" key={id}>
        <h3>{exercises[id].name}</h3><div className="two-col">
          <label>目标 e1RM kg<input aria-label={`${exercises[id].name}目标`} type="number" min="1" max="600" step=".5" placeholder="暂不设置" value={settings.goals[id] ?? ""} onChange={e => {
            const goals = { ...settings.goals }; if (e.target.value) goals[id] = Number(e.target.value); else delete goals[id]; setSettings({ ...settings, goals });
          }} /></label>
          <label>最小加重 kg<input aria-label={`${exercises[id].name}最小加重`} required type="number" min=".5" max="10" step=".5" value={settings.increments[id] ?? exercises[id].step} onChange={e => setSettings({ ...settings, increments: { ...settings.increments, [id]: Number(e.target.value) } })} /></label>
        </div>
      </div>)}
      {error && <p className="alert error" role="alert">{error}</p>}
      <button className="primary wide" disabled={busy}>保存设置与目标</button>
    </form>
    <section className="card"><h2>数据与隐私</h2><p>完成的训练保存在服务器数据库；进行中的草稿只在当前浏览器。换设备前先结束并保存。导出的 JSON 含私人训练信息，请妥善保管。</p>
      <p>可以把此页面添加到手机主屏幕。当前版本不承诺离线加载；断网期间已经打开的训练页面仍可填写草稿，联网后再保存。</p></section>
  </>;
}

function Trend({ points }: { points: { at: string; value: number; source: string }[] }) {
  if (!points.length) return <div className="empty-chart">你的下一次训练，就是曲线的起点。</div>;
  const shown = points.slice(-30);
  const min = Math.min(...shown.map(p => p.value)) * .9;
  const max = Math.max(...shown.map(p => p.value)) * 1.05;
  const start = Date.parse(shown[0].at);
  const span = Math.max(1, Date.parse(shown[shown.length - 1].at) - start);
  const x = (at: string) => shown.length === 1 ? 160 : 12 + (Date.parse(at) - start) / span * 296;
  const y = (value: number) => 125 - (value - min) / Math.max(1, max - min) * 105;
  return <><svg className="chart" viewBox="0 0 320 150" role="img" aria-label="按实际日期排列的最近 30 个估算力量样本">
    {[35, 80, 125].map(v => <line x1="0" x2="320" y1={v} y2={v} key={v} stroke="#dfe7e0" />)}
    <polyline fill="none" stroke="#24794c" strokeWidth="3" strokeLinejoin="round" points={shown.map(p => `${x(p.at)},${y(p.value)}`).join(" ")} />
    {shown.map((p, i) => <circle key={i} cx={x(p.at)} cy={y(p.value)} r="4" fill="#24794c"><title>{dateLabel(p.at)}：{p.value} kg · {p.source}</title></circle>)}
  </svg><div className="section-title hint"><span>{dateLabel(shown[0].at)}</span><span>{dateLabel(shown[shown.length - 1].at)}</span></div>
    <details><summary>查看曲线数据</summary>{shown.map((p, i) => <p key={i}>{dateLabel(p.at)} · {p.value} kg · {p.source}</p>)}</details></>;
}
