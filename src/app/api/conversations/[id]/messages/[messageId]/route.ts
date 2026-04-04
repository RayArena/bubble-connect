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
import { removeChatAttachmentsFromSupabase } from "@/lib/supabase-storage";
import type { MessageAttachment } from "@/types/db";

interface Context {
  params: Promise<{ id: string; messageId: string }>;
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

function getAttachmentPaths(attachments: unknown) {
  if (!Array.isArray(attachments)) {
    return [] as string[];
  }

  return Array.from(
    new Set(
      attachments
        .map((attachment) => (attachment && typeof attachment === "object" ? (attachment as MessageAttachment).path : ""))
        .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
    )
  );
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

export async function PATCH(request: Request, context: Context) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const parsedBody = await readJsonBody<{ content?: unknown }>(request);
  if (parsedBody.error) return parsedBody.error;

  const nextContent = typeof parsedBody.body?.content === "string" ? parsedBody.body.content.trim() : "";

  const { id: conversationId, messageId } = await context.params;
  const db = await getDb();

  const membership = await db.collection("conversation_members").findOne({
    conversation_id: conversationId,
    user_id: authState.userId,
  });

  if (!membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existingMessage = await db.collection("messages").findOne({
    id: messageId,
    conversation_id: conversationId,
  });

  if (!existingMessage) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existingMessage.sender_id !== authState.userId) {
    return NextResponse.json({ error: "You can only edit your own messages" }, { status: 403 });
  }

  const existingAttachments = Array.isArray(existingMessage.attachments) ? existingMessage.attachments : [];
  if (!nextContent && existingAttachments.length === 0) {
    return badRequest("Message content cannot be empty");
  }

  const now = new Date();
  const nextType = resolveMessageType(nextContent, existingAttachments.length);

  await db.collection("messages").updateOne(
    { id: messageId, conversation_id: conversationId },
    {
      $set: {
        content: nextContent,
        type: nextType,
        updated_at: now,
      },
    }
  );

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
    ...serializeDoc({
      ...existingMessage,
      content: nextContent,
      type: nextType,
      updated_at: now,
    }),
    attachments: withProxyAttachmentUrls(existingMessage.attachments),
    sender: sender ? serializeDoc(sender) : null,
  };

  const memberUserIds = await getMemberUserIds(db, conversationId);

  void publishRealtimeEvent([roomForConversation(conversationId)], "message.updated", {
    conversationId,
    message: serializedMessage,
  });

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

export async function DELETE(_request: Request, context: Context) {
  try {
    const authState = await requireUserId();
    if (authState.error) return authState.error;

    const { id: conversationId, messageId } = await context.params;
    const db = await getDb();

    const membership = await db.collection("conversation_members").findOne({
      conversation_id: conversationId,
      user_id: authState.userId,
    });

    if (!membership) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const existingMessage = await db.collection("messages").findOne({
      id: messageId,
      conversation_id: conversationId,
    });

    if (!existingMessage) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (existingMessage.sender_id !== authState.userId) {
      return NextResponse.json({ error: "You can only delete your own messages" }, { status: 403 });
    }

    const attachmentPaths = getAttachmentPaths(existingMessage.attachments);

    await db.collection("messages").deleteOne({
      id: messageId,
      conversation_id: conversationId,
    });

    const now = new Date();

    await db
      .collection("conversations")
      .updateOne({ id: conversationId }, { $set: { updated_at: now } });

    if (attachmentPaths.length) {
      const messagesWithSharedAttachments = await db
        .collection("messages")
        .find(
          {
            id: { $ne: messageId },
            "attachments.path": { $in: attachmentPaths },
          },
          {
            projection: {
              _id: 0,
              attachments: 1,
            },
          }
        )
        .toArray();

      const stillReferencedPaths = new Set<string>();

      messagesWithSharedAttachments.forEach((messageDoc) => {
        if (!Array.isArray(messageDoc.attachments)) {
          return;
        }

        messageDoc.attachments.forEach((attachment) => {
          const path =
            attachment && typeof attachment === "object" && typeof attachment.path === "string"
              ? attachment.path
              : "";

          if (path && attachmentPaths.includes(path)) {
            stillReferencedPaths.add(path);
          }
        });
      });

      const pathsToDelete = attachmentPaths.filter((path) => !stillReferencedPaths.has(path));

      if (pathsToDelete.length) {
        await removeChatAttachmentsFromSupabase(pathsToDelete).catch(() => null);
      }
    }

    const memberUserIds = await getMemberUserIds(db, conversationId);

    void publishRealtimeEvent([roomForConversation(conversationId)], "message.deleted", {
      conversationId,
      messageId,
    });

    if (memberUserIds.length) {
      void publishRealtimeEvent(
        memberUserIds.map((userId) => roomForUser(userId)),
        "conversations.changed",
        {
          conversationId,
        }
      );
    }

    return NextResponse.json({ ok: true, messageId });
  } catch (error) {
    return internalServerError(error, "Failed to delete message");
  }
}
