import { NextResponse } from "next/server";
import { health } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await health()); }
  catch (error) {
    console.error("lift-log health check failed", error);
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
