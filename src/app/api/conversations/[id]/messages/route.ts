import { NextResponse } from "next/server";
import { readJsonBody, requireUserId, serializeDoc } from "@/lib/api-helpers";
import { getDb } from "@/lib/mongodb";
import { publishRealtimeEvent, roomForConversation, roomForUser } from "@/lib/realtime";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: Context) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const { id: conversationId } = await context.params;
  const db = await getDb();

  const membership = await db.collection("conversation_members").findOne({
    conversation_id: conversationId,
    user_id: authState.userId,
  });

  if (!membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await db
    .collection("messages")
    .find({ conversation_id: conversationId }, {
      projection: {
        _id: 1,
        id: 1,
        conversation_id: 1,
        sender_id: 1,
        content: 1,
        type: 1,
        created_at: 1,
        updated_at: 1,
      },
    })
    .sort({ created_at: 1 })
    .limit(100)
    .toArray();

  const senderIds = Array.from(new Set(messages.map((m) => m.sender_id)));
  const senders = senderIds.length
    ? await db
        .collection("profiles")
        .find(
          { user_id: { $in: senderIds }, is_deleted: { $ne: true } },
          {
            projection: {
              _id: 1,
              id: 1,
              user_id: 1,
              username: 1,
              display_name: 1,
              avatar_url: 1,
              bio: 1,
              status: 1,
              created_at: 1,
              updated_at: 1,
            },
          }
        )
        .toArray()
    : [];

  const senderMap: Record<string, ReturnType<typeof serializeDoc>> = {};
  senders.forEach((sender) => {
    senderMap[sender.user_id] = serializeDoc(sender);
  });

  return NextResponse.json({
    messages: messages.map((message) => ({
      ...serializeDoc(message),
      sender: senderMap[message.sender_id] || null,
    })),
  });
}

export async function POST(request: Request, context: Context) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const { id: conversationId } = await context.params;
  const parsed = await readJsonBody<{ content?: unknown }>(request);
  if (parsed.error) return parsed.error;

  const content = typeof parsed.body?.content === "string" ? parsed.body.content.trim() : "";

  if (!content) {
    return NextResponse.json({ error: "Message content is required" }, { status: 400 });
  }

  const db = await getDb();

  const membership = await db.collection("conversation_members").findOne({
    conversation_id: conversationId,
    user_id: authState.userId,
  });

  if (!membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date();
  const newMessage = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    sender_id: authState.userId,
    content,
    type: "text",
    created_at: now,
    updated_at: now,
  };

  await db.collection("messages").insertOne(newMessage);
  await db
    .collection("conversations")
    .updateOne({ id: conversationId }, { $set: { updated_at: now } });

  const sender = await db.collection("profiles").findOne(
    { user_id: authState.userId, is_deleted: { $ne: true } },
    {
      projection: {
        _id: 1,
        id: 1,
        user_id: 1,
        username: 1,
        display_name: 1,
        avatar_url: 1,
        bio: 1,
        status: 1,
        created_at: 1,
        updated_at: 1,
      },
    }
  );

  const serializedMessage = {
    ...serializeDoc(newMessage),
    sender: sender ? serializeDoc(sender) : null,
  };

  const members = await db
    .collection("conversation_members")
    .find(
      { conversation_id: conversationId },
      {
        projection: {
          _id: 0,
          user_id: 1,
        },
      }
    )
    .toArray();

  const memberUserIds = Array.from(new Set(members.map((member) => member.user_id).filter(Boolean)));

  void publishRealtimeEvent(
    [roomForConversation(conversationId)],
    "message.created",
    {
      conversationId,
      message: serializedMessage,
    }
  );

  if (memberUserIds.length) {
    void publishRealtimeEvent(
      memberUserIds.map((userId) => roomForUser(userId)),
      "conversations.changed",
      {
        conversationId,
      }
    );
  }

  return NextResponse.json({ message: serializedMessage });
}
