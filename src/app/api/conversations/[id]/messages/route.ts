import { NextResponse } from "next/server";
import { badRequest, internalServerError, readJsonBody, requireUserId, serializeDoc } from "@/lib/api-helpers";
import { getDb } from "@/lib/mongodb";
import { publishRealtimeEvent, roomForConversation, roomForUser } from "@/lib/realtime";
import {
  getChatAttachmentLimits,
  removeChatAttachmentsFromSupabase,
  uploadChatAttachmentToSupabase,
} from "@/lib/supabase-storage";
import type { MessageAttachment, MessageAttachmentCategory } from "@/types/db";

interface Context {
  params: Promise<{ id: string }>;
}

export const runtime = "nodejs";

const imageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "heic",
  "heif",
]);

const videoExtensions = new Set([
  "mp4",
  "mov",
  "mkv",
  "avi",
  "webm",
  "m4v",
  "3gp",
  "flv",
]);

const audioExtensions = new Set([
  "mp3",
  "wav",
  "ogg",
  "aac",
  "m4a",
  "flac",
  "wma",
  "opus",
]);

function isValidClientMessageId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function getFileExtension(fileName: string) {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot >= trimmed.length - 1) {
    return "";
  }

  return trimmed.slice(lastDot + 1).toLowerCase();
}

function toAttachmentCategory(mimeType: string, fileName: string): MessageAttachmentCategory {
  const normalizedMimeType = (mimeType || "").toLowerCase();
  const extension = getFileExtension(fileName);

  if (normalizedMimeType.startsWith("image/") || imageExtensions.has(extension)) {
    return "image";
  }

  if (normalizedMimeType.startsWith("video/") || videoExtensions.has(extension)) {
    return "video";
  }

  if (normalizedMimeType.startsWith("audio/") || audioExtensions.has(extension)) {
    return "audio";
  }

  return "document";
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

interface ParsedIncomingMessage {
  content: string;
  clientMessageId: string | null;
  files: File[];
}

async function parseIncomingMessageRequest(request: Request) {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return {
        parsed: null,
        error: badRequest("Invalid multipart body"),
      };
    }

    const contentRaw = formData.get("content");
    const clientMessageIdRaw = formData.get("clientMessageId");
    const content = typeof contentRaw === "string" ? contentRaw.trim() : "";

    const files = formData
      .getAll("attachments")
      .filter((value): value is File => value instanceof File && value.size > 0);

    const parsed: ParsedIncomingMessage = {
      content,
      clientMessageId: isValidClientMessageId(clientMessageIdRaw) ? clientMessageIdRaw : null,
      files,
    };

    return {
      parsed,
      error: null,
    };
  }

  const body = await readJsonBody<{ content?: unknown; clientMessageId?: unknown }>(request);
  if (body.error) {
    return {
      parsed: null,
      error: body.error,
    };
  }

  const parsed: ParsedIncomingMessage = {
    content: typeof body.body?.content === "string" ? body.body.content.trim() : "",
    clientMessageId: isValidClientMessageId(body.body?.clientMessageId) ? body.body.clientMessageId : null,
    files: [],
  };

  return {
    parsed,
    error: null,
  };
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
        attachments: 1,
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
  const parsedBody = await parseIncomingMessageRequest(request);
  if (parsedBody.error || !parsedBody.parsed) {
    return parsedBody.error || badRequest("Invalid request body");
  }

  const { content, clientMessageId, files } = parsedBody.parsed;
  const { maxFilesPerMessage, maxFileSizeBytes } = getChatAttachmentLimits();

  if (!content && files.length === 0) {
    return badRequest("Message content or at least one attachment is required");
  }

  if (files.length > maxFilesPerMessage) {
    return badRequest(`You can upload up to ${maxFilesPerMessage} files per message`);
  }

  const oversizedFile = files.find((file) => file.size > maxFileSizeBytes);
  if (oversizedFile) {
    const maxSizeMb = Math.round(maxFileSizeBytes / (1024 * 1024));
    return badRequest(`"${oversizedFile.name || "file"}" exceeds the ${maxSizeMb}MB size limit`);
  }

  const db = await getDb();

  const membership = await db.collection("conversation_members").findOne({
    conversation_id: conversationId,
    user_id: authState.userId,
  });

  if (!membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messageId = clientMessageId || crypto.randomUUID();
  const uploadedAttachmentPaths: string[] = [];

  try {
    const attachments: MessageAttachment[] = [];

    for (const file of files) {
      const uploadedAttachment = await uploadChatAttachmentToSupabase({
        conversationId,
        messageId,
        file,
      });

      uploadedAttachmentPaths.push(uploadedAttachment.path);

      attachments.push({
        id: crypto.randomUUID(),
        bucket: uploadedAttachment.bucket,
        path: uploadedAttachment.path,
        url: uploadedAttachment.url,
        file_name: uploadedAttachment.fileName,
        mime_type: uploadedAttachment.mimeType,
        size_bytes: uploadedAttachment.sizeBytes,
        category: toAttachmentCategory(uploadedAttachment.mimeType, uploadedAttachment.fileName),
      });
    }

    const now = new Date();
    const newMessage = {
      id: messageId,
      conversation_id: conversationId,
      sender_id: authState.userId,
      content,
      type: resolveMessageType(content, attachments.length),
      attachments,
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
  } catch (error) {
    if (uploadedAttachmentPaths.length) {
      await removeChatAttachmentsFromSupabase(uploadedAttachmentPaths).catch(() => null);
    }

    return internalServerError(error, "Failed to send message");
  }
}
