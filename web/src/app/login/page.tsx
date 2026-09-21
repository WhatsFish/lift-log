"use client";

import { useState } from "react";
import { Disclaimer } from "@/components/Disclaimer";

export default function Login() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <main className="shell">
    <header className="topbar"><span className="brand"><span className="brand-mark">L</span> LIFT LOG</span><span className="tag">私人训练空间</span></header>
    <section className="hero"><p className="eyebrow">YOUR STRENGTH, YOUR SPACE</p><h1>准备好，<br />再进步一点。</h1><p>输入你的 Key，继续训练与记录。</p></section>
    <form className="card" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        const response = await fetch("/lift-log/api/login", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
        });
        if (response.status === 429) throw new Error("尝试过于频繁，请稍后再试。");
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "无法登录");
        window.location.assign("/lift-log");
      } catch (e) { setError(e instanceof Error ? e.message : "无法连接服务器"); setBusy(false); }
    }}>
      <label>登录 Key<input required name="key" type="password" autoComplete="current-password" maxLength={256} value={key} onChange={e => setKey(e.target.value)} /></label>
      {error && <p className="alert error" role="alert">{error}</p>}
      <button className="primary wide" disabled={busy}>{busy ? "登录中…" : "进入训练日志"}</button>
      <p className="hint">此设备保持登录 7 天。请勿在共享设备上保存 Key。</p>
    </form>
    <Disclaimer />
  </main>;
}
