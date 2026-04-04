import { NextResponse } from "next/server";
import {
  badRequest,
  internalServerError,
  readJsonBody,
  requireUserId,
  serializeDoc,
} from "@/lib/api-helpers";
import { getDb } from "@/lib/mongodb";
import { publishRealtimeEvent, roomForConversation, roomForUser } from "@/lib/realtime";
import type { MessageAttachment } from "@/types/db";

interface Context {
  params: Promise<{ id: string }>;
}

interface ForwardPayload {
  targetConversationId?: unknown;
  messageIds?: unknown;
}

export const runtime = "nodejs";

function buildAttachmentProxyUrl(attachmentId: string) {
  return `/api/attachments/${encodeURIComponent(attachmentId)}`;
}

function withProxyAttachmentUrls(attachments: unknown) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.map((attachment) => {
    if (!attachment || typeof attachment !== "object") {
      return attachment;
    }

    const typedAttachment = attachment as MessageAttachment;
    const hasId = typeof typedAttachment.id === "string" && typedAttachment.id.trim().length > 0;
    if (!hasId) {
      return typedAttachment;
    }

    return {
      ...typedAttachment,
      url: buildAttachmentProxyUrl(typedAttachment.id),
    };
  });
}

function resolveMessageType(content: string, attachmentCount: number) {
  if (!attachmentCount) {
    return "text";
  }

  if (!content.trim()) {
    return "attachment";
  }

  return "mixed";
}

function normalizeMessageIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  const ids = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(ids));
}

function cloneForwardedAttachment(attachment: MessageAttachment): MessageAttachment {
  const nextAttachmentId = crypto.randomUUID();

  return {
    ...attachment,
    id: nextAttachmentId,
    url: buildAttachmentProxyUrl(nextAttachmentId),
  };
}

async function getMemberUserIds(db: Awaited<ReturnType<typeof getDb>>, conversationId: string) {
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

  return Array.from(new Set(members.map((member) => member.user_id).filter(Boolean)));
}

export async function POST(request: Request, context: Context) {
  try {
    const authState = await requireUserId();
    if (authState.error) return authState.error;

    const parsed = await readJsonBody<ForwardPayload>(request);
    if (parsed.error) return parsed.error;

    const { id: sourceConversationId } = await context.params;
    const targetConversationIdRaw =
      typeof parsed.body?.targetConversationId === "string" ? parsed.body.targetConversationId.trim() : "";
    const messageIds = normalizeMessageIds(parsed.body?.messageIds);

    if (!targetConversationIdRaw) {
      return badRequest("Target conversation is required");
    }

    if (!messageIds.length) {
      return badRequest("At least one message is required to forward");
    }

    if (messageIds.length > 100) {
      return badRequest("You can forward up to 100 messages at once");
    }

    const db = await getDb();

    const [sourceMembership, targetMembership] = await Promise.all([
      db.collection("conversation_members").findOne({
        conversation_id: sourceConversationId,
        user_id: authState.userId,
      }),
      db.collection("conversation_members").findOne({
        conversation_id: targetConversationIdRaw,
        user_id: authState.userId,
      }),
    ]);

    if (!sourceMembership || !targetMembership) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const sourceMessages = await db
      .collection("messages")
      .find(
        {
          conversation_id: sourceConversationId,
          id: { $in: messageIds },
        },
        {
          projection: {
            _id: 1,
            id: 1,
            conversation_id: 1,
            sender_id: 1,
            content: 1,
            type: 1,
            attachments: 1,
            created_at: 1,
            updated_at: 1,
          },
        }
      )
      .toArray();

    if (!sourceMessages.length) {
      return badRequest("No valid messages found to forward");
    }

    const sourceMessageById = new Map(sourceMessages.map((message) => [message.id as string, message]));
    const orderedSourceMessages = messageIds
      .map((messageId) => sourceMessageById.get(messageId))
      .filter(Boolean);

    if (!orderedSourceMessages.length) {
      return badRequest("No valid messages found to forward");
    }

    const nowBase = Date.now();
    const forwardedMessages = orderedSourceMessages.map((sourceMessage, index) => {
      const attachments = Array.isArray(sourceMessage?.attachments)
        ? sourceMessage.attachments
            .filter(
              (attachment): attachment is MessageAttachment =>
                Boolean(
                  attachment &&
                    typeof attachment === "object" &&
                    typeof attachment.id === "string" &&
                    typeof attachment.path === "string" &&
                    typeof attachment.bucket === "string" &&
                    typeof attachment.file_name === "string" &&
                    typeof attachment.mime_type === "string"
                )
            )
            .map((attachment) => cloneForwardedAttachment(attachment))
        : [];

      const content = typeof sourceMessage?.content === "string" ? sourceMessage.content : "";
      const timestamp = new Date(nowBase + index);

      return {
        id: crypto.randomUUID(),
        conversation_id: targetConversationIdRaw,
        sender_id: authState.userId,
        content,
        type: resolveMessageType(content, attachments.length),
        attachments,
        created_at: timestamp,
        updated_at: timestamp,
      };
    });

    await db.collection("messages").insertMany(forwardedMessages);

    const conversationTouchTime = new Date();

    await db
      .collection("conversations")
      .updateOne({ id: targetConversationIdRaw }, { $set: { updated_at: conversationTouchTime } });

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

    const serializedMessages = forwardedMessages.map((message) => ({
      ...serializeDoc(message),
      attachments: withProxyAttachmentUrls(message.attachments),
      sender: sender ? serializeDoc(sender) : null,
    }));

    const targetMemberUserIds = await getMemberUserIds(db, targetConversationIdRaw);

    serializedMessages.forEach((message) => {
      void publishRealtimeEvent([roomForConversation(targetConversationIdRaw)], "message.created", {
        conversationId: targetConversationIdRaw,
        message,
      });
    });

    if (targetMemberUserIds.length) {
      void publishRealtimeEvent(
        targetMemberUserIds.map((userId) => roomForUser(userId)),
        "conversations.changed",
        {
          conversationId: targetConversationIdRaw,
        }
      );
    }

    return NextResponse.json({ messages: serializedMessages });
  } catch (error) {
    return internalServerError(error, "Failed to forward messages");
  }
}
