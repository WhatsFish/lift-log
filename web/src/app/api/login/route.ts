import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, checkKey, createSession, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const text = await request.text();
    if (text.length > 2048) return NextResponse.json({ error: "输入过长" }, { status: 413 });
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }
    if (!value || typeof value !== "object" || !("key" in value) ||
      typeof value.key !== "string" || value.key.length > 256 || !checkKey(value.key)) {
      return NextResponse.json({ error: "Key 不正确" }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, createSession(), sessionCookieOptions());
    return response;
  } catch (error) {
    console.error("lift-log login failed", error);
    return NextResponse.json({ error: "登录服务暂不可用，请稍后重试" }, { status: 503 });
  }
}
