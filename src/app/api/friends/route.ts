import { NextResponse } from "next/server";
import { requireUserId, serializeDoc } from "@/lib/api-helpers";
import { getDb } from "@/lib/mongodb";

export async function GET() {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const db = await getDb();
  const friendshipDocs = await db
    .collection("friendships")
    .find({
      status: "accepted",
      $or: [{ requester_id: authState.userId }, { addressee_id: authState.userId }],
    })
    .toArray();

  const friendIds = friendshipDocs.map((f) =>
    f.requester_id === authState.userId ? f.addressee_id : f.requester_id
  );

  if (!friendIds.length) {
    return NextResponse.json({ friends: [] });
  }

  const profiles = await db
    .collection("profiles")
    .find({ user_id: { $in: friendIds } })
    .toArray();

  return NextResponse.json({ friends: profiles.map(serializeDoc) });
}
