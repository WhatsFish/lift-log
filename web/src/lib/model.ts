import { z } from "zod";

export const exercises = {
  squat: { name: "杠铃深蹲", step: 2.5, lower: true },
  bench: { name: "杠铃卧推", step: 2.5, lower: false },
  deadlift: { name: "传统硬拉", step: 2.5, lower: true },
  press: { name: "站姿推举", step: 1, lower: false },
  row: { name: "胸托划船", step: 2.5, lower: false },
  rdl: { name: "罗马尼亚硬拉", step: 2.5, lower: true },
  pulldown: { name: "高位下拉", step: 2.5, lower: false },
} as const;
export const exerciseIds = ["squat", "bench", "deadlift", "press", "row", "rdl", "pulldown"] as const;
export type Exercise = typeof exerciseIds[number];
const exerciseSchema = z.enum(exerciseIds);
const dateSchema = z.string().datetime().refine(
  value => Date.parse(value) <= Date.now() + 300_000 && Date.parse(value) >= Date.parse("2000-01-01"),
  "日期不能在未来或早于 2000 年",
);
const weight = z.number().finite().min(0.5).max(500);
export const settingsSchema = z.object({
  mode: z.enum(["cut", "maintain"]).default("cut"),
  minutes: z.union([z.literal(45), z.literal(60), z.literal(75)]).default(60),
  lastTrainingAt: dateSchema.nullable().default(null),
  increments: z.record(exerciseSchema, z.number().min(0.5).max(10)).default({}),
  goals: z.record(exerciseSchema, z.number().min(1).max(600)).default({}),
}).strict();
export const setSchema = z.object({
  exercise: exerciseSchema,
  weight,
  reps: z.number().int().min(1).max(30),
  rir: z.number().int().min(0).max(5),
}).strict();
export const sessionSchema = z.object({
  id: z.string().uuid(),
  at: dateSchema,
  kind: z.enum(["A", "B", "boxing", "cardio"]),
  sets: z.array(setSchema).max(40),
  duration: z.number().int().min(1).max(240),
  cardio: z.enum(["none", "incline", "stairs", "boxing"]),
  cardioMinutes: z.number().int().min(0).max(120),
  effort: z.number().int().min(1).max(10),
  note: z.string().max(1000),
}).strict().superRefine((s, ctx) => {
  const strength = s.kind === "A" || s.kind === "B";
  if (strength && s.sets.length === 0) ctx.addIssue({ code: "custom", message: "至少记录一个实际完成的工作组" });
  if (!strength && s.sets.length) ctx.addIssue({ code: "custom", message: "有氧训练不能包含力量组" });
  if (s.cardioMinutes > s.duration) ctx.addIssue({ code: "custom", message: "有氧时间不能超过总时长" });
  if ((s.cardio === "none") !== (s.cardioMinutes === 0)) ctx.addIssue({ code: "custom", message: "请检查有氧类型和时长" });
  if (!strength && s.cardio === "none") ctx.addIssue({ code: "custom", message: "请选择有氧类型" });
  if (s.kind === "boxing" && s.cardio !== "boxing") ctx.addIssue({ code: "custom", message: "搏击训练请选择搏击类型" });
});
export const benchmarkSchema = z.object({
  id: z.string().uuid(),
  at: dateSchema,
  exercise: exerciseSchema,
  weight,
  reps: z.number().int().min(1).max(10),
  rir: z.number().int().min(0).max(3),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export type WorkSet = z.infer<typeof setSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Benchmark = z.infer<typeof benchmarkSchema>;
export type State = { revision: number; settings: Settings; sessions: Session[]; benchmarks: Benchmark[] };
export const emptyState = (): State => ({
  revision: 0, settings: settingsSchema.parse({}), sessions: [], benchmarks: [],
});
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session"), revision: z.number().int().nonnegative(), value: sessionSchema }).strict(),
  z.object({ type: z.literal("benchmark"), revision: z.number().int().nonnegative(), value: benchmarkSchema }).strict(),
  z.object({ type: z.literal("settings"), revision: z.number().int().nonnegative(), value: settingsSchema }).strict(),
  z.object({ type: z.literal("delete"), revision: z.number().int().nonnegative(), collection: z.enum(["sessions", "benchmarks"]), id: z.string().uuid() }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
