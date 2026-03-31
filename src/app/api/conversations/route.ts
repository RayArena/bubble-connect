import { NextResponse } from "next/server";
import { internalServerError, readJsonBody, requireUserId, serializeDoc } from "@/lib/api-helpers";
import { getDb } from "@/lib/mongodb";

export async function GET() {
  try {
    const authState = await requireUserId();
    if (authState.error) return authState.error;

    const db = await getDb();
    const members = await db
      .collection("conversation_members")
      .find({ user_id: authState.userId })
      .toArray();

    const ids = members.map((m) => m.conversation_id);
    if (!ids.length) return NextResponse.json({ conversations: [] });

    const conversations = await db
      .collection("conversations")
      .find({ id: { $in: ids } })
      .sort({ updated_at: -1 })
      .toArray();

    const profiles = db.collection("profiles");

    const enriched = await Promise.all(
      conversations.map(async (conversation) => {
        if (conversation.type === "dm") {
          const otherMember = await db.collection("conversation_members").findOne({
            conversation_id: conversation.id,
            user_id: { $ne: authState.userId },
          });

          if (otherMember) {
            const otherUser = await profiles.findOne({ user_id: otherMember.user_id, is_deleted: { $ne: true } });

            if (!otherUser) {
              return null;
            }

            return {
              ...serializeDoc(conversation),
              otherUser: otherUser ? serializeDoc(otherUser) : null,
            };
          }

          return null;
        }

        return {
          ...serializeDoc(conversation),
          otherUser: null,
        };
      })
    );

    return NextResponse.json({ conversations: enriched.filter(Boolean) });
  } catch (error) {
    return internalServerError(error, "Conversations fetch failed");
  }
}

export async function POST(request: Request) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const parsed = await readJsonBody<{ type?: unknown; name?: unknown; memberIds?: unknown }>(request);
  if (parsed.error) return parsed.error;

  const type = parsed.body?.type;
  const name = typeof parsed.body?.name === "string" ? parsed.body.name.trim() : null;
  const memberIds: string[] = Array.isArray(parsed.body?.memberIds)
    ? parsed.body.memberIds.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean)
    : [];

  if (type === "dm") {
    const friendUserId = memberIds[0];
    if (!friendUserId) {
      return NextResponse.json({ error: "friend user required" }, { status: 400 });
    }

    const db = await getDb();
    const friendProfile = await db
      .collection("profiles")
      .findOne({ user_id: friendUserId, is_deleted: { $ne: true } }, { projection: { _id: 1 } });

    if (!friendProfile) {
      return NextResponse.json({ error: "friend user not found" }, { status: 404 });
    }

    const myMemberships = await db
      .collection("conversation_members")
      .find({ user_id: authState.userId })
      .toArray();

    for (const member of myMemberships) {
      const conv = await db.collection("conversations").findOne({
        id: member.conversation_id,
        type: "dm",
      });
      if (!conv) continue;

      const hasFriend = await db.collection("conversation_members").findOne({
        conversation_id: conv.id,
        user_id: friendUserId,
      });

      if (hasFriend) {
        return NextResponse.json({ conversation: serializeDoc(conv), existed: true });
      }
    }

    const now = new Date();
    const conversationId = crypto.randomUUID();

    await db.collection("conversations").insertOne({
      id: conversationId,
      type: "dm",
      name: null,
      avatar_url: null,
      created_by: authState.userId,
      created_at: now,
      updated_at: now,
    });

    await db.collection("conversation_members").insertMany([
      {
        id: crypto.randomUUID(),
        conversation_id: conversationId,
        user_id: authState.userId,
        role: "member",
        joined_at: now,
      },
      {
        id: crypto.randomUUID(),
        conversation_id: conversationId,
        user_id: friendUserId,
        role: "member",
        joined_at: now,
      },
    ]);

    const conversation = await db.collection("conversations").findOne({ id: conversationId });
    return NextResponse.json({ conversation: conversation ? serializeDoc(conversation) : null, existed: false });
  }

  if (type === "group") {
    if (!name || memberIds.length === 0) {
      return NextResponse.json({ error: "name and members are required" }, { status: 400 });
    }

    const db = await getDb();
    const now = new Date();
    const conversationId = crypto.randomUUID();

    await db.collection("conversations").insertOne({
      id: conversationId,
      type: "group",
      name,
      avatar_url: null,
      created_by: authState.userId,
      created_at: now,
      updated_at: now,
    });

    const allMembers = Array.from(new Set([authState.userId, ...memberIds]));
    await db.collection("conversation_members").insertMany(
      allMembers.map((memberId) => ({
        id: crypto.randomUUID(),
        conversation_id: conversationId,
        user_id: memberId,
        role: memberId === authState.userId ? "admin" : "member",
        joined_at: now,
      }))
    );

    const conversation = await db.collection("conversations").findOne({ id: conversationId });
    return NextResponse.json({ conversation: conversation ? serializeDoc(conversation) : null, existed: false });
  }

  return NextResponse.json({ error: "invalid conversation type" }, { status: 400 });
}
