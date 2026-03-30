import { NextResponse } from "next/server";
import { requireUserId, serializeDoc } from "@/lib/api-helpers";
import { getDb } from "@/lib/mongodb";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: Context) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const { id } = await context.params;
  const db = await getDb();

  const membership = await db.collection("conversation_members").findOne({
    conversation_id: id,
    user_id: authState.userId,
  });

  if (!membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const conversation = await db.collection("conversations").findOne({ id });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let otherUser = null;
  if (conversation.type === "dm") {
    const member = await db.collection("conversation_members").findOne({
      conversation_id: id,
      user_id: { $ne: authState.userId },
    });
    if (member) {
      const profile = await db
        .collection("profiles")
        .findOne({ user_id: member.user_id, is_deleted: { $ne: true } });
      otherUser = profile ? serializeDoc(profile) : null;
    }
  }

  return NextResponse.json({
    conversation: serializeDoc(conversation),
    otherUser,
  });
}
