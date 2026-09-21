import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  // Nginx authenticates and overwrites this header; the app port is loopback-only.
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();
  if (!request.headers.get("x-lift-user")) {
    return NextResponse.json({ error: "请通过受保护的网站入口登录" }, { status: 401 });
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = process.env.PUBLIC_ORIGIN;
    if (!origin || request.headers.get("origin") !== origin) {
      return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return NextResponse.json({ error: "需要 JSON 请求" }, { status: 415 });
    }
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
