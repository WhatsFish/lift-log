import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "lift_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new Error("SESSION_SECRET is not configured");
  return value;
}
export function checkKey(key: string) {
  const expected = process.env.LOGIN_KEY_HASH;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("LOGIN_KEY_HASH is not configured");
  return timingSafeEqual(createHash("sha256").update(key).digest(), Buffer.from(expected, "hex"));
}
export function createSession(now = Date.now()) {
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(16).toString("hex")}`;
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("hex")}`;
}
export function validSession(token: string | undefined, now = Date.now()) {
  if (!token || token.length > 160) return false;
  const match = /^(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + SESSION_SECONDS) return false;
  const expected = createHmac("sha256", secret()).update(`${match[1]}.${match[2]}`).digest();
  return timingSafeEqual(expected, Buffer.from(match[3], "hex"));
}
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.PUBLIC_ORIGIN?.startsWith("https://") ?? true,
    sameSite: "strict" as const,
    path: "/lift-log",
    maxAge: SESSION_SECONDS,
  };
}
