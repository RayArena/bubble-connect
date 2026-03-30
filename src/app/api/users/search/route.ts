import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireUserId, serializeDoc } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const query = request.nextUrl.searchParams.get("query")?.trim().toLowerCase();
  if (!query) return NextResponse.json({ users: [] });

  const db = await getDb();
  const users = await db
    .collection("profiles")
    .find({
      user_id: { $ne: authState.userId },
      is_deleted: { $ne: true },
      username: { $regex: query, $options: "i" },
    })
    .limit(10)
    .toArray();

  return NextResponse.json({ users: users.map(serializeDoc) });
}
