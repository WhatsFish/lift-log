import { createHash, randomBytes } from "node:crypto";
import { appendFile, chmod, readFile, writeFile, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const privateFile = `${homedir()}/.config/lift-log.env`;
const appFile = `${root}.env`;
const statusFile = `${root}../status/.env`;
for (const path of [privateFile, appFile]) {
  try { await lstat(path); throw new Error(`Refusing to overwrite existing credentials: ${path}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const status = await readFile(statusFile, "utf8");
if (/^LIFT_PG_/m.test(status)) throw new Error("Status credentials already configured; refusing to append duplicates");
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 258) throw new Error("Login key input is too long");
}
const key = input.trimEnd();
if (!key || key.length > 256) throw new Error("Supply the chosen login key via stdin (1–256 characters)");
const password = randomBytes(32).toString("hex");
const monitorPassword = randomBytes(32).toString("hex");
const signingSecret = randomBytes(32).toString("hex");
await writeFile(privateFile, `LIFT_PG_PASSWORD=${password}\nLIFT_MONITOR_PG_PASSWORD=${monitorPassword}\n`, { mode: 0o600, flag: "wx" });
await writeFile(appFile, [
  `PG_PASSWORD=${password}`,
  `LOGIN_KEY_HASH=${createHash("sha256").update(key).digest("hex")}`,
  `SESSION_SECRET=${signingSecret}`,
  "PUBLIC_ORIGIN=https://ai-native.japaneast.cloudapp.azure.com",
  "NEXT_PUBLIC_UMAMI_SRC=",
  "NEXT_PUBLIC_UMAMI_WEBSITE_ID=",
  "",
].join("\n"), { mode: 0o600, flag: "wx" });
await appendFile(statusFile, `\n# Lift Log read-only monitoring\nLIFT_PG_USER=lift_log_monitor\nLIFT_PG_DB=lift_log\nLIFT_PG_PASSWORD=${monitorPassword}\n`);
await chmod(statusFile, 0o600);
console.log("Created protected app credentials and appended read-only status connection; no secrets printed.");
