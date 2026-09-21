import { NextRequest, NextResponse } from "next/server";
import { actionSchema } from "@/lib/model";
import { ConflictError, MissingError, getState, mutate } from "@/lib/db";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await getState()); }
  catch (error) {
    console.error("lift-log state read failed", error);
    return NextResponse.json({ error: "无法读取训练数据，请稍后重试" }, { status: 503 });
  }
}
export async function POST(request: NextRequest) {
  try {
    const text = await request.text();
    if (text.length > 64_000) return NextResponse.json({ error: "记录过大" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { return NextResponse.json({ error: "JSON 格式错误" }, { status: 400 }); }
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join("；") }, { status: 400 });
    return NextResponse.json(await mutate(parsed.data));
  } catch (error) {
    if (error instanceof ConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof MissingError) return NextResponse.json({ error: error.message }, { status: 404 });
    console.error("lift-log state write failed", error);
    return NextResponse.json({ error: "未能保存到服务器。请保留此页面或草稿后重试。" }, { status: 503 });
  }
}
