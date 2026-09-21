import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

test.beforeEach(async ({ context, request }) => {
  const db = new Pool({ host: "127.0.0.1", port: 55435, database: "lift_test", user: "lift_test", password: "ephemeral-test-only" });
  try { await db.query("TRUNCATE app_state"); }
  finally { await db.end(); }
  for (const client of [context.request, request]) {
    const login = await client.post("http://127.0.0.1:3015/lift-log/api/login", { data: { key: "test-only-key" } });
    expect(login.status()).toBe(200);
  }
});

test("mobile workout, local draft, goals, cardio, export and durable records", async ({ page, request }) => {
  await page.goto("/lift-log");
  await expect(page.getByText("今天也可以开始。")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: test.info().outputPath("mobile-home.png"), fullPage: true });
  await page.getByRole("button", { name: "力量", exact: true }).click();
  await page.getByLabel("重量 kg", { exact: true }).fill("60");
  await page.getByRole("button", { name: "保存力量评估" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存到服务器");
  await expect(page.getByText("历史估算 PR")).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("杠铃深蹲目标", { exact: true }).fill("100");
  await page.getByRole("button", { name: "保存设置与目标" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存到服务器");
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await page.getByRole("button", { name: "记录搏击 / 有氧" }).click();
  await page.getByLabel("整体强度 1–10", { exact: true }).fill("8");
  await page.getByRole("button", { name: "保存有氧打卡" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存到服务器");
  await page.getByRole("button", { name: "开始这次训练" }).click();
  await page.getByLabel("杠铃深蹲 第1组重量", { exact: true }).fill("40");
  await page.getByLabel("杠铃深蹲 第1组完成", { exact: true }).check();
  await page.reload();
  await expect(page.getByText("专注这一组。")).toBeVisible();
  await expect(page.getByLabel("杠铃深蹲 第1组完成", { exact: true })).toBeChecked();
  await expect(page.getByLabel("杠铃深蹲 第1组重量", { exact: true })).toHaveValue("40");
  await page.getByLabel("有氧分钟", { exact: true }).fill("0");
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "结束训练并打卡" }).click();
  await expect(page.getByRole("heading", { name: "每一次，都算数。" })).toBeVisible();
  await expect(page.getByText("40 kg × 4（余 4）")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部记录 JSON" }).click();
  expect((await download).suggestedFilename()).toContain("lift-log");
  await page.reload();
  await expect(page.getByRole("heading", { name: "下一次 · 全身 B" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始这次训练" })).toBeDisabled();
  const state = await (await request.get("/lift-log/api/state")).json();
  expect(state.sessions).toHaveLength(2);
  expect(state.sessions.find((s: { kind: string }) => s.kind === "A").sets).toHaveLength(1);
  expect(state.settings.goals.squat).toBe(100);
});

test("API rejects unauthenticated, cross-origin, invalid and stale writes", async ({ playwright, request }) => {
  const unauth = await playwright.request.newContext({ extraHTTPHeaders: {} });
  expect((await unauth.get("http://127.0.0.1:3015/lift-log/api/state")).status()).toBe(401);
  expect((await unauth.get("http://127.0.0.1:3015/lift-log/api/health")).status()).toBe(200);
  await unauth.dispose();
  const sample = { id: randomUUID(), kind: "A", at: new Date().toISOString(), sets: [{ exercise: "squat", weight: 40, reps: 5, rir: 3 }], duration: 45, cardio: "none", cardioMinutes: 0, effort: 6, note: "" };
  expect((await request.post("/lift-log/api/state", { data: { type: "session", revision: 0, value: sample } })).status()).toBe(200);
  const state = await (await request.get("/lift-log/api/state")).json();
  const action = { type: "settings", revision: state.revision, value: state.settings };
  expect((await request.post("/lift-log/api/state", { data: action, headers: { origin: "https://example.invalid" } })).status()).toBe(403);
  expect((await request.post("/lift-log/api/state", { data: { ...action, value: { mode: "bad" } } })).status()).toBe(400);
  expect((await request.post("/lift-log/api/state", { data: { ...action, revision: 0 } })).status()).toBe(409);
  const session = state.sessions.find((s: { kind: string }) => s.kind === "A");
  const retry = await request.post("/lift-log/api/state", { data: { type: "session", revision: 0, value: session } });
  expect(retry.status()).toBe(200);
  expect((await retry.json()).sessions).toHaveLength(1);
});

test("failed save retains draft and never shows successful check-in", async ({ page }) => {
  await page.goto("/lift-log");
  await page.evaluate(() => {
    localStorage.setItem("lift-log.draft.v1", JSON.stringify({
      id: crypto.randomUUID(), kind: "B", startedAt: new Date().toISOString(),
      exercises: [{ exercise: "bench", min: 4, max: 6, rows: [{ weight: "30", reps: "5", rir: "3", done: true }] }],
      cardio: "none", cardioMinutes: "0", duration: "45", effort: "6", note: "",
    }));
  });
  await page.reload();
  await page.route("**/api/state", route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "数据库暂不可用" }) })
    : route.continue());
  await page.getByRole("button", { name: "结束训练并打卡" }).click();
  await expect(page.locator(".alert.error")).toContainText("数据库暂不可用");
  await expect(page.getByText("专注这一组。")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("lift-log.draft.v1"))).toContain('"weight":"30"');
});

test("concurrent writes cannot overwrite each other; deletion recalculates progress", async ({ request }) => {
  const value = { id: randomUUID(), at: new Date().toISOString(), exercise: "bench", weight: 40, reps: 5, rir: 2 };
  const values = [value, { ...value, id: randomUUID(), weight: 50 }];
  const responses = await Promise.all(values.map(value => request.post("/lift-log/api/state", {
    data: { type: "benchmark", revision: 0, value },
  })));
  expect(responses.map(r => r.status()).sort()).toEqual([200, 409]);
  let state = await (await request.get("/lift-log/api/state")).json();
  expect(state.benchmarks).toHaveLength(1);
  const staleId = values.find(v => v.id !== state.benchmarks[0].id)!;
  expect((await request.post("/lift-log/api/state", {
    data: { type: "benchmark", revision: state.revision, value: staleId },
  })).status()).toBe(200);
  state = await (await request.get("/lift-log/api/state")).json();
  expect(state.benchmarks).toHaveLength(2);
  const removed = await request.post("/lift-log/api/state", {
    data: { type: "delete", revision: state.revision, collection: "benchmarks", id: value.id },
  });
  expect(removed.status()).toBe(200);
  expect((await removed.json()).benchmarks).toHaveLength(1);
});

test("small phone viewport has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/lift-log");
  await expect(page.getByRole("button", { name: "开始这次训练" })).toBeVisible();
  for (const tab of ["今日", "力量", "记录", "设置"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  }
});

test("key login rejects wrong keys, persists a session and supports logout", async ({ page, context, playwright }) => {
  await context.clearCookies();
  await page.goto("/lift-log");
  await expect(page).toHaveURL(/\/lift-log\/login$/);
  await page.getByLabel("登录 Key").fill("wrong");
  await page.getByRole("button", { name: "进入训练日志" }).click();
  await expect(page.locator(".alert.error")).toHaveText("Key 不正确");
  await page.getByLabel("登录 Key").fill("test-only-key");
  await page.getByRole("button", { name: "进入训练日志" }).click();
  await expect(page.getByText("今天也可以开始。")).toBeVisible();
  const cookie = (await context.cookies()).find(c => c.name === "lift_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  await page.reload();
  await expect(page.getByText("今天也可以开始。")).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/lift-log\/login$/);
  expect((await context.request.get("/lift-log/api/state")).status()).toBe(401);
  const attacker = await playwright.request.newContext({ extraHTTPHeaders: { "x-lift-user": "forged", origin: "https://invalid.example" } });
  expect((await attacker.get("http://127.0.0.1:3015/lift-log/api/state")).status()).toBe(401);
  expect((await attacker.post("http://127.0.0.1:3015/lift-log/api/login", { data: { key: "test-only-key" } })).status()).toBe(403);
  await attacker.dispose();
});
