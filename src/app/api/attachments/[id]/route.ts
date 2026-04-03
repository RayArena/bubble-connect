import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/api-helpers";
import { getDb } from "@/lib/mongodb";
import { downloadChatAttachmentFromSupabase } from "@/lib/supabase-storage";

interface Context {
  params: Promise<{ id: string }>;
}

export const runtime = "nodejs";

function sanitizeFileName(fileName: string) {
  const safe = (fileName || "attachment").replace(/[\\"\r\n]/g, "_").trim();
  return safe || "attachment";
}

function encodeRFC5987Value(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildContentDisposition(fileName: string, forceDownload: boolean) {
  const safeName = sanitizeFileName(fileName);
  const encodedName = encodeRFC5987Value(safeName);
  const dispositionType = forceDownload ? "attachment" : "inline";

  return `${dispositionType}; filename="${safeName}"; filename*=UTF-8''${encodedName}`;
}

export async function GET(request: Request, context: Context) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const { id: attachmentId } = await context.params;
  if (!attachmentId || !attachmentId.trim()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = await getDb();
  const messageDoc = await db.collection("messages").findOne(
    { "attachments.id": attachmentId },
    {
      projection: {
        _id: 0,
        conversation_id: 1,
        attachments: 1,
      },
    }
  );

  if (!messageDoc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const membership = await db.collection("conversation_members").findOne(
    {
      conversation_id: messageDoc.conversation_id,
      user_id: authState.userId,
    },
    {
      projection: { _id: 1 },
    }
  );

  if (!membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const attachment = Array.isArray(messageDoc.attachments)
    ? messageDoc.attachments.find((item) => item?.id === attachmentId)
    : null;

  if (
    !attachment ||
    typeof attachment.bucket !== "string" ||
    !attachment.bucket ||
    typeof attachment.path !== "string" ||
    !attachment.path
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const forceDownload = new URL(request.url).searchParams.get("download") === "1";
    const fileName =
      typeof attachment.file_name === "string" && attachment.file_name.trim()
        ? attachment.file_name
        : "attachment";

    const downloaded = await downloadChatAttachmentFromSupabase({
      bucket: attachment.bucket,
      path: attachment.path,
    });

    const headers = new Headers();
    headers.set(
      "Content-Type",
      downloaded.contentType ||
        (typeof attachment.mime_type === "string" && attachment.mime_type.trim()
          ? attachment.mime_type
          : "application/octet-stream")
    );
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("Content-Disposition", buildContentDisposition(fileName, forceDownload));

    const contentLength =
      typeof attachment.size_bytes === "number" && Number.isFinite(attachment.size_bytes)
        ? attachment.size_bytes
        : downloaded.sizeBytes;

    if (typeof contentLength === "number" && contentLength > 0) {
      headers.set("Content-Length", String(contentLength));
    }

    return new Response(downloaded.data, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Attachment fetch failed", error);
    return NextResponse.json({ error: "Unable to fetch attachment" }, { status: 502 });
  }
}
