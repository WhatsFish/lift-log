import { type Exercise, type Session, type State, exercises } from "./model";

const DAY = 86_400_000;
export const daysSince = (at: string, now: Date) => Math.max(0, (now.getTime() - Date.parse(at)) / DAY);
export const e1rm = (weight: number, reps: number, rir = 0) =>
  Math.round((reps + rir === 1 ? weight : weight * (1 + (reps + rir) / 30)) * 10) / 10;
export const isStrength = (s: Session) => s.kind === "A" || s.kind === "B";
export const chronological = <T extends { at: string }>(items: T[]) =>
  [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

export function strengthPoints(state: State, exercise: Exercise) {
  const points = state.benchmarks.filter(b => b.exercise === exercise).map(b => ({
    at: b.at, value: e1rm(b.weight, b.reps, b.rir), source: "评估", benchmark: true,
  }));
  for (const s of state.sessions) {
    const sets = s.sets.filter(x => x.exercise === exercise && x.reps <= 10 && x.rir <= 3);
    if (sets.length) points.push({
      at: s.at, value: Math.max(...sets.map(x => e1rm(x.weight, x.reps, x.rir))),
      source: "训练", benchmark: false,
    });
  }
  return chronological(points);
}

export function strengthSummary(state: State, exercise: Exercise, now = new Date()) {
  const points = strengthPoints(state, exercise).filter(p => Date.parse(p.at) <= now.getTime());
  if (!points.length) return { pr: null, current: null, age: null, points };
  const latest = points[points.length - 1];
  const lastAssessment = points.filter(p => p.benchmark).at(-1);
  const recent = points.filter(p => daysSince(p.at, new Date(latest.at)) <= 42 &&
    (!lastAssessment || Date.parse(p.at) >= Date.parse(lastAssessment.at))).slice(-3);
  const sorted = recent.map(p => p.value).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { pr: Math.max(...points.map(p => p.value)), current: Math.round(current * 10) / 10,
    age: Math.floor(daysSince(latest.at, now)), points };
}

type Template = { exercise: Exercise; sets: number; min: number; max: number; light?: boolean };
const templates: Record<"A" | "B", Template[]> = {
  A: [
    { exercise: "squat", sets: 3, min: 4, max: 6 },
    { exercise: "bench", sets: 3, min: 4, max: 6 },
    { exercise: "row", sets: 3, min: 6, max: 8 },
    { exercise: "rdl", sets: 2, min: 6, max: 8 },
  ],
  B: [
    { exercise: "deadlift", sets: 2, min: 3, max: 5 },
    { exercise: "press", sets: 2, min: 4, max: 6 },
    { exercise: "pulldown", sets: 3, min: 6, max: 8 },
    { exercise: "bench", sets: 2, min: 6, max: 8, light: true },
    { exercise: "squat", sets: 2, min: 6, max: 8, light: true },
  ],
};
export type Readiness = "good" | "tired" | "poor";
export type Prescription = Template & { weight: number | null; rir: number; reasons: string[] };
export type Plan = {
  kind: "A" | "B"; gap: number | null; returning: boolean; blocked: boolean;
  exercises: Prescription[]; reasons: string[]; cardioMinutes: number; boxingCount: number;
  strengthCount: number;
};

export function makePlan(state: State, options: {
  now?: Date; readiness?: Readiness; kind?: "A" | "B"; pain?: boolean;
} = {}): Plan {
  const now = options.now ?? new Date();
  const readiness = options.readiness ?? "good";
  const sessions = chronological(state.sessions.filter(s => Date.parse(s.at) <= now.getTime()));
  const strength = sessions.filter(isStrength);
  const latest = strength.at(-1);
  const lastAt = latest?.at ?? state.settings.lastTrainingAt;
  const gap = lastAt ? daysSince(lastAt, now) : null;
  const kind = options.kind ?? (latest?.kind === "A" ? "B" : "A");
  let streak = 0;
  for (let i = strength.length - 1; i >= 0; i--) {
    if (i < strength.length - 1 && daysSince(strength[i].at, new Date(strength[i + 1].at)) >= 14) break;
    streak++;
  }
  if (gap !== null && gap >= 14) streak = 0;
  const returning = streak < 3;
  const blocked = Boolean(options.pain) || (gap !== null && gap < 1);
  const reasons: string[] = ["按完成顺序轮换 A/B，不欠课、不补课；有氧打卡不改变力量顺序。"];
  if (returning) reasons.push("恢复训练的前 3 次：减少工作组、预留 3–4 次，不追旧 PR。");
  if (gap !== null && gap >= 14) reasons.push(`距上次力量训练 ${Math.floor(gap)} 天：本次启用回归减量。`);
  if (blocked) reasons.push(options.pain ? "有疼痛时暂停负重训练；持续或明显疼痛请咨询专业人员。" : "距离上次力量训练不足 24 小时：今天建议恢复或轻松散步。");
  if (readiness !== "good") reasons.push("根据今日状态降低重量和组数，不补回减少的训练量。");
  if (gap !== null && gap >= 1 && gap < 2) reasons.push("距上次力量不足 48 小时：额外减量，优先恢复。");
  const recentHard = sessions.some(s => s.effort >= 8 && daysSince(s.at, now) < 2);
  if (recentHard) reasons.push("最近 48 小时有高强度训练，下肢建议额外减重。");
  const phase = gap !== null && gap >= 90 ? .7 : gap !== null && gap >= 28 ? .8
    : returning ? (streak === 0 ? .85 : streak === 1 ? .9 : .95) : 1;
  const fatigue = readiness === "poor" ? .85 : readiness === "tired" ? .95 : 1;
  const shortRest = gap !== null && gap < 2 ? .9 : 1;
  const lowVolume = returning || readiness !== "good" || shortRest < 1;
  const prescriptions = templates[kind].map((t): Prescription => {
    const summary = strengthSummary(state, t.exercise, now);
    const step = state.settings.increments[t.exercise] ?? exercises[t.exercise].step;
    const age = summary.age ?? 0;
    const stale = age >= 90 ? .7 : age >= 28 ? .8 : age >= 14 ? .9 : 1;
    const lowerFatigue = recentHard && exercises[t.exercise].lower ? .9 : 1;
    const factor = Math.min(phase, stale) * fatigue * shortRest * lowerFatigue;
    const explanation: string[] = [];
    if (summary.current === null) explanation.push("尚无力量数据：热身后找保留 4 次的重量，或先录入力量评估。");
    if (age >= 14) explanation.push(`力量样本已 ${age} 天未更新，保守下调；历史 PR 不作为直接处方。`);
    if (factor < 1) explanation.push(`回归 / 恢复系数 ${Math.round(factor * 100)}%。`);
    const matches = strength.filter(s => s.kind === kind && s.sets.some(x => x.exercise === t.exercise)).slice(-2);
    const previous = matches.at(-1);
    const newerAssessment = previous && state.benchmarks.some(b => b.exercise === t.exercise &&
      Date.parse(b.at) > Date.parse(previous.at) && Date.parse(b.at) <= now.getTime());
    const priorSets = previous?.sets.filter(x => x.exercise === t.exercise) ?? [];
    const reference = priorSets[0]?.weight;
    let target = summary.current === null ? null : summary.current * (t.min >= 6 ? .67 : .75);
    if (target === null && reference && previous && daysSince(previous.at, now) < 14) {
      target = reference;
      explanation.push("尚无可靠 e1RM：参考近期实际工作重量，不据此推算 PR。");
    }
    if (reference && previous && !newerAssessment && daysSince(previous.at, now) < 14 && !returning && stale === 1) {
      target = reference;
      const requiredSets = state.settings.minutes === 45 ? Math.min(t.sets, 2) : t.sets;
      const ready = priorSets.length >= requiredSets && priorSets.every(x => x.weight === reference && x.reps >= t.max && x.rir >= 2);
      const failedTwice = matches.length === 2 && matches.every(s => {
        const sets = s.sets.filter(x => x.exercise === t.exercise);
        return sets.some(x => x.reps < t.min || x.rir === 0);
      });
      if (failedTwice) { target *= .925; explanation.push("连续两次未达次数下限或到力竭：减重约 7.5%。"); }
      else if (ready && factor === 1) { target += step; explanation.push(`所有工作组达到上限且保留 ≥2 次：建议加 ${step} kg。`); }
      else explanation.push("维持近期重量，先增加规范次数；未完成全部目标组不自动加重。");
    }
    const sets = state.settings.minutes === 45 ? Math.min(t.sets, 2) : lowVolume ? Math.min(t.sets, 2) : t.sets;
    const rounded = target === null ? null : Math.floor(target * factor / step) * step;
    if (rounded === 0) explanation.push("计算重量低于器械最小增量，请选更轻器械或调整最小加重后重新校准。");
    return { ...t, sets, weight: rounded === 0 ? null : rounded,
      rir: returning ? 4 : state.settings.mode === "cut" || readiness !== "good" ? 3 : 2,
      reasons: explanation };
  });
  return { kind, gap: gap === null ? null : Math.floor(gap), returning, blocked, exercises: prescriptions, reasons,
    cardioMinutes: readiness === "poor" ? 0 : state.settings.minutes === 45 ? 5 : 10,
    boxingCount: sessions.filter(s => s.kind === "boxing" && daysSince(s.at, now) < 7).length,
    strengthCount: strength.filter(s => daysSince(s.at, now) < 7).length };
}
