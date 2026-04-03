import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedSupabaseAdminClient: SupabaseClient | null = null;

function readRequiredSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url) {
    throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) environment variable");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
  }

  return { url, serviceRoleKey };
}

function getSupabaseAdminClient() {
  if (cachedSupabaseAdminClient) {
    return cachedSupabaseAdminClient;
  }

  const { url, serviceRoleKey } = readRequiredSupabaseConfig();

  cachedSupabaseAdminClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedSupabaseAdminClient;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim();
  const base = trimmed || "file";

  return base
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "file";
}

function splitNameAndExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return {
      stem: fileName,
      extension: "",
    };
  }

  return {
    stem: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot + 1),
  };
}

function buildAttachmentPath(conversationId: string, messageId: string, fileName: string) {
  const safeName = sanitizeFileName(fileName);
  const { stem, extension } = splitNameAndExtension(safeName);
  const uniqueToken = crypto.randomUUID();

  const finalName = extension
    ? `${stem}-${uniqueToken}.${extension.toLowerCase()}`
    : `${stem}-${uniqueToken}`;

  return `${conversationId}/${messageId}/${finalName}`;
}

export function getSupabaseStorageBucket() {
  return (process.env.SUPABASE_STORAGE_BUCKET || "chat-attachments").trim();
}

export function getChatAttachmentLimits() {
  return {
    maxFilesPerMessage: readPositiveInteger(process.env.CHAT_ATTACHMENT_MAX_FILES, 10),
    maxFileSizeBytes: readPositiveInteger(process.env.CHAT_ATTACHMENT_MAX_BYTES, 100 * 1024 * 1024),
  };
}

export interface UploadedAttachment {
  bucket: string;
  path: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DownloadedAttachment {
  data: Blob;
  contentType: string | null;
  sizeBytes: number | null;
}

export async function uploadChatAttachmentToSupabase(params: {
  conversationId: string;
  messageId: string;
  file: File;
}): Promise<UploadedAttachment> {
  const { conversationId, messageId, file } = params;
  const bucket = getSupabaseStorageBucket();
  if (!bucket) {
    throw new Error("Missing SUPABASE_STORAGE_BUCKET environment variable");
  }

  const client = getSupabaseAdminClient();
  const fileName = file.name || "file";
  const path = buildAttachmentPath(conversationId, messageId, fileName);
  const mimeType = file.type || "application/octet-stream";
  const sizeBytes = file.size || 0;
  const data = Buffer.from(await file.arrayBuffer());

  const uploadResult = await client.storage.from(bucket).upload(path, data, {
    contentType: mimeType,
    upsert: false,
    cacheControl: "3600",
  });

  if (uploadResult.error) {
    throw new Error(`Supabase upload failed: ${uploadResult.error.message}`);
  }

  const publicUrlResult = client.storage.from(bucket).getPublicUrl(path);
  const publicUrl = publicUrlResult.data.publicUrl;

  if (!publicUrl) {
    throw new Error("Failed to build public URL for uploaded attachment");
  }

  return {
    bucket,
    path,
    url: publicUrl,
    fileName,
    mimeType,
    sizeBytes,
  };
}

export async function removeChatAttachmentsFromSupabase(paths: string[]) {
  if (!paths.length) return;

  const bucket = getSupabaseStorageBucket();
  if (!bucket) return;

  const client = getSupabaseAdminClient();
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));

  if (!uniquePaths.length) return;

  const result = await client.storage.from(bucket).remove(uniquePaths);
  if (result.error) {
    console.error("Supabase cleanup failed", result.error);
  }
}

export async function downloadChatAttachmentFromSupabase(params: {
  bucket: string;
  path: string;
}): Promise<DownloadedAttachment> {
  const { bucket, path } = params;
  if (!bucket || !path) {
    throw new Error("Attachment bucket and path are required");
  }

  const client = getSupabaseAdminClient();
  const result = await client.storage.from(bucket).download(path);

  if (result.error) {
    throw new Error(`Supabase download failed: ${result.error.message}`);
  }

  if (!result.data) {
    throw new Error("Supabase download returned no data");
  }

  return {
    data: result.data,
    contentType: result.data.type || null,
    sizeBytes: typeof result.data.size === "number" ? result.data.size : null,
  };
}
