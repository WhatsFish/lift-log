import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, validSession } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/api/health") return NextResponse.next();
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = process.env.PUBLIC_ORIGIN;
    if (!origin || request.headers.get("origin") !== origin) {
      return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return NextResponse.json({ error: "需要 JSON 请求" }, { status: 415 });
    }
  }
  if (path === "/login" || path === "/api/login") return NextResponse.next();
  try {
    if (!validSession(request.cookies.get(SESSION_COOKIE)?.value)) {
      if (path.startsWith("/api/")) return NextResponse.json({ error: "登录已过期，请重新登录；训练草稿仍保留" }, { status: 401 });
      return NextResponse.redirect(new URL("/lift-log/login", request.url));
    }
  } catch (error) {
    console.error("lift-log session configuration error", error);
    return NextResponse.json({ error: "登录服务暂不可用" }, { status: 503 });
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
