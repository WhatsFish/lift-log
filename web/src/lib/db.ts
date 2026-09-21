import { Pool } from "pg";
import { isDeepStrictEqual } from "node:util";
import { type Action, type State, emptyState } from "./model";

const pool = new Pool({
  host: process.env.PG_HOST ?? "db", port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? "lift_log", database: process.env.PG_DB ?? "lift_log",
  password: process.env.PG_PASSWORD, max: 4, connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000, options: "-c statement_timeout=5000",
});
pool.on("error", error => console.error("lift-log idle database connection error", error.message));

export class ConflictError extends Error {}
export class MissingError extends Error {}

export async function getState(): Promise<State> {
  const result = await pool.query<{ data: Omit<State, "revision">; revision: number }>("SELECT data, revision FROM app_state WHERE id=1");
  return result.rows.length ? { ...result.rows[0].data, revision: result.rows[0].revision } : emptyState();
}

export async function mutate(action: Action): Promise<State> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { revision: _revision, ...initial } = emptyState();
    await client.query("INSERT INTO app_state(id,data) VALUES(1,$1) ON CONFLICT DO NOTHING", [initial]);
    const result = await client.query<{ data: Omit<State, "revision">; revision: number }>("SELECT data,revision FROM app_state WHERE id=1 FOR UPDATE");
    const row = result.rows[0];
    const state: State = { ...row.data, revision: row.revision };
    if (action.type === "session" || action.type === "benchmark") {
      const collection = action.type === "session" ? state.sessions : state.benchmarks;
      const existing = collection.find(item => item.id === action.value.id);
      if (existing && isDeepStrictEqual(existing, action.value)) {
        await client.query("COMMIT");
        return state;
      }
      if (existing) throw new ConflictError("记录 ID 已存在，请刷新后重试");
    }
    if (state.revision !== action.revision) throw new ConflictError("数据已在其他窗口更新，请加载最新数据后重试；本地训练草稿仍保留");
    if (action.type === "session") state.sessions.push(action.value);
    if (action.type === "benchmark") state.benchmarks.push(action.value);
    if (action.type === "settings") state.settings = action.value;
    if (action.type === "delete") {
      if (!state[action.collection].some(item => item.id === action.id)) throw new MissingError("记录不存在");
      if (action.collection === "sessions") state.sessions = state.sessions.filter(item => item.id !== action.id);
      else state.benchmarks = state.benchmarks.filter(item => item.id !== action.id);
    }
    state.revision++;
    const { revision, ...data } = state;
    await client.query("UPDATE app_state SET revision=$1,data=$2,updated_at=now() WHERE id=1", [revision, data]);
    await client.query("COMMIT");
    return state;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function health() {
  await pool.query("SELECT id FROM app_state LIMIT 1");
  return { status: "ok" };
}
