import { z } from "zod";
import { exerciseIds } from "./model";

export const draftSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["A", "B"]),
  startedAt: z.string().datetime(),
  exercises: z.array(z.object({
    exercise: z.enum(exerciseIds),
    min: z.number(), max: z.number(),
    rows: z.array(z.object({
      weight: z.string(), reps: z.string(), rir: z.string(), done: z.boolean(),
    })).min(1).max(6),
  })).min(1).max(7),
  cardio: z.enum(["none", "incline", "stairs"]),
  cardioMinutes: z.string(),
  duration: z.string(),
  effort: z.string(),
  note: z.string(),
});
export type Draft = z.infer<typeof draftSchema>;
export const DRAFT_KEY = "lift-log.draft.v1";
export function localDateTime(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
