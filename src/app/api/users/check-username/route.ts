import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username")?.trim().toLowerCase();

  if (!username || username.length < 3) {
    return NextResponse.json({ available: false });
  }

  try {
    const db = await getDb();
    const exists = await db.collection("profiles").findOne({ username }, { projection: { _id: 1 } });
    return NextResponse.json({ available: !exists });
  } catch (error) {
    console.error("Username availability check failed", error);
    return NextResponse.json(
      {
        available: false,
        error: "Username check temporarily unavailable",
      },
      { status: 503 }
    );
  }
}
