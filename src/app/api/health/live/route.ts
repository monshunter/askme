import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ data: { status: "live", service: "askme-web" }, error: null });
}
