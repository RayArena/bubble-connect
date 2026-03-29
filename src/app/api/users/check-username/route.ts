import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username")?.trim().toLowerCase();

  if (!username || username.length < 3) {
    return NextResponse.json({ available: false });
  }

  const db = await getDb();
  const exists = await db.collection("profiles").findOne({ username });
  return NextResponse.json({ available: !exists });
}
