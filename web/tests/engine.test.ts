import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { benchmarkSchema, emptyState, sessionSchema, settingsSchema, type Session, type State } from "../src/lib/model";
import { e1rm, makePlan, strengthSummary } from "../src/lib/engine";

const now = new Date("2026-09-20T12:00:00Z");
const at = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
function fixture(): State {
  const state = emptyState();
  state.benchmarks = ["squat", "bench", "deadlift"].map(exercise => benchmarkSchema.parse({
    id: randomUUID(), exercise, at: at(2), weight: 60, reps: 5, rir: 2,
  }));
  return state;
}
function session(days: number, kind: "A" | "B", reps = 6, rir = 2, count = 3): Session {
  return { id: randomUUID(), at: at(days), kind, duration: 50, cardio: "none", cardioMinutes: 0,
    effort: 6, note: "", sets: Array.from({ length: count }, () => ({ exercise: "squat", weight: 50, reps, rir })) };
}
function established(): State {
  const state = fixture();
  state.benchmarks.forEach(b => b.at = at(15));
  state.sessions = [session(12, "A"), session(9, "B"), session(6, "A"), session(3, "B")];
  return state;
}
const squat = (state: State, opts: Parameters<typeof makePlan>[1] = {}) =>
  makePlan(state, { now, kind: "A", ...opts }).exercises.find(e => e.exercise === "squat")!;

test("Epley handles true single and RIR", () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(e1rm(60, 5), 70);
  assert.equal(e1rm(60, 5, 2), 74);
});
test("empty state never invents personal starting weights", () => {
  const p = makePlan(emptyState(), { now });
  assert.equal(p.kind, "A"); assert.equal(p.returning, true);
  assert.ok(p.exercises.every(e => e.weight === null && e.sets <= 2 && e.rir === 4));
});
test("alternates by chronological strength completion, not array order or weekday", () => {
  const state = fixture();
  state.sessions = [session(3, "A"), session(7, "B")];
  assert.equal(makePlan(state, { now }).kind, "B");
  assert.equal(makePlan(state, { now: new Date("2026-09-21T12:00:00Z") }).kind, "B");
});
test("boxing check-ins do not advance A/B", () => {
  const state = fixture();
  state.sessions = [session(3, "A"), { ...session(1, "B"), kind: "boxing", sets: [], cardio: "boxing", cardioMinutes: 30 }];
  assert.equal(makePlan(state, { now }).kind, "B");
  assert.equal(makePlan(state, { now }).boxingCount, 1);
});
test("today's PR does not erase a year without training", () => {
  const state = fixture(); state.settings.lastTrainingAt = at(365);
  const p = makePlan(state, { now });
  assert.equal(p.gap, 365); assert.equal(p.returning, true);
  assert.ok(squat(state).weight! < squat(fixture()).weight!);
});
test("long absence reduces both volume and load", () => {
  const normal = established();
  const stale = established();
  stale.sessions.forEach((s, i) => s.at = at(380 - i * 3));
  stale.benchmarks.forEach(b => b.at = at(400));
  assert.ok(squat(stale).weight! < squat(normal).weight!);
  assert.equal(squat(stale).sets, 2);
  assert.equal(squat(stale).rir, 4);
});
test("old PR stays visible but a lower new assessment becomes current", () => {
  const state = fixture();
  state.benchmarks = [
    { ...state.benchmarks[0], at: at(365), weight: 120, reps: 1, rir: 0 },
    { ...state.benchmarks[0], id: randomUUID(), at: at(1), weight: 60, reps: 1, rir: 0 },
  ];
  const summary = strengthSummary(state, "squat", now);
  assert.equal(summary.pr, 120); assert.equal(summary.current, 60);
});
test("RIR >3 and >10 rep sets are excluded from e1RM", () => {
  const state = emptyState(); state.sessions = [session(2, "A", 5, 4), session(1, "A", 12, 2)];
  assert.equal(strengthSummary(state, "squat", now).current, null);
});
test("increases only after every required set reaches top with RIR >=2", () => {
  assert.equal(squat(established()).weight, 52.5);
  const partial = established(); partial.sessions[2].sets.pop();
  assert.equal(squat(partial).weight, 50);
  const hard = established(); hard.sessions[2].sets[0].rir = 1;
  assert.equal(squat(hard).weight, 50);
});
test("45-minute plan progresses after its actual two-set target", () => {
  const state = established(); state.settings.minutes = 45;
  state.sessions[2].sets.pop();
  assert.equal(squat(state).sets, 2); assert.equal(squat(state).weight, 52.5);
});
test("mixed working weights do not trigger progression", () => {
  const state = established(); state.sessions[2].sets[1].weight = 40;
  assert.equal(squat(state).weight, 50);
});
test("two struggling exposures reduce load", () => {
  const state = established();
  state.sessions[0].sets[0].reps = 3; state.sessions[2].sets[0].reps = 3;
  assert.equal(squat(state).weight, 45);
});
test("fatigue takes precedence over progression", () => {
  assert.ok(squat(established(), { readiness: "poor" }).weight! < 50);
  assert.equal(squat(established(), { readiness: "poor" }).sets, 2);
  assert.equal(makePlan(established(), { now, readiness: "poor" }).cardioMinutes, 0);
});
test("recent high effort boxing lowers lower-body prescriptions", () => {
  const normal = established(); const tired = established();
  tired.sessions.push({ ...session(1, "A"), kind: "boxing", sets: [], effort: 9, cardio: "boxing", cardioMinutes: 30 });
  assert.ok(squat(tired).weight! < squat(normal).weight!);
});
test("pain or less than 24h prevents starting another strength session", () => {
  assert.equal(makePlan(fixture(), { now, pain: true }).blocked, true);
  const state = fixture(); state.sessions = [session(.5, "A")];
  assert.equal(makePlan(state, { now }).blocked, true);
});
test("48h recovery boundary lowers load, not weekday-dependent", () => {
  const state = established(); state.sessions[3].at = at(1.5);
  assert.ok(squat(state).weight! < squat(established()).weight!);
});
test("return phase resets after break and ramps for three actual sessions", () => {
  const state = fixture(); state.sessions = [session(40, "A"), session(3, "B")];
  assert.equal(makePlan(state, { now }).returning, true);
  state.sessions.push(session(2, "A"), session(1, "B"));
  assert.equal(makePlan(state, { now }).returning, false);
});
test("untrained lift remains stale despite other recent lifts", () => {
  const state = established(); state.benchmarks.find(b => b.exercise === "deadlift")!.at = at(365);
  const deadlift = makePlan(state, { now, kind: "B" }).exercises[0];
  assert.ok(deadlift.reasons.some(r => r.includes("365")));
  assert.ok(deadlift.weight! < 40);
});
test("invalid values and future dates are rejected", () => {
  assert.equal(benchmarkSchema.safeParse({ id: randomUUID(), at: new Date(Date.now() + 86_400_000).toISOString(), exercise: "squat", weight: 60, reps: 5, rir: 0 }).success, false);
  assert.equal(sessionSchema.safeParse({ ...session(2, "A"), sets: [] }).success, false);
  assert.equal(sessionSchema.safeParse({ ...session(2, "A"), sets: [{ exercise: "squat", weight: -1, reps: 5, rir: 2 }] }).success, false);
  assert.equal(settingsSchema.safeParse({ goals: { squat: -10 } }).success, false);
});
test("cardio fields are consistent", () => {
  assert.equal(sessionSchema.safeParse({ ...session(2, "A"), cardio: "none", cardioMinutes: 5 }).success, false);
  assert.equal(sessionSchema.safeParse({ ...session(2, "A"), cardio: "incline", cardioMinutes: 60, duration: 45 }).success, false);
});
test("goals do not force training weights upward", () => {
  const state = established(); const before = squat(state).weight;
  state.settings.goals.squat = 300;
  assert.equal(squat(state).weight, before);
});
test("fresh lower assessment overrides old working weight", () => {
  const state = established();
  state.benchmarks.push({ id: randomUUID(), exercise: "squat", at: at(1), weight: 40, reps: 1, rir: 0 });
  assert.equal(squat(state).weight, 30);
});
test("minimum plate increment never forces a weight above the calculated load", () => {
  const state = fixture(); state.benchmarks[0].weight = .5; state.benchmarks[0].reps = 1;
  assert.equal(squat(state).weight, null);
});
