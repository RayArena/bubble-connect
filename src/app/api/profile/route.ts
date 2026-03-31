import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import type { Collection, Document } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { badRequest, readJsonBody, requireUserId, serializeDoc, toIsoDate } from "@/lib/api-helpers";
import { permanentlyDeleteUserData } from "@/lib/user-lifecycle";

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 30;

function normalizeUsername(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, USERNAME_MAX_LENGTH);
}

async function resolveUniqueUsername(
  profiles: Collection<Document>,
  requestedUsername: string,
  userId: string
) {
  const base = requestedUsername;
  let candidate = base;
  let attempt = 0;

  while (attempt < 30) {
    const existing = await profiles.findOne({ username: candidate }, { projection: { _id: 1, user_id: 1 } });
    if (!existing || existing.user_id === userId) {
      return candidate;
    }

    attempt += 1;
    const suffix = `_${attempt}`;
    candidate = `${base.slice(0, USERNAME_MAX_LENGTH - suffix.length)}${suffix}`;
  }

  return `${base.slice(0, USERNAME_MAX_LENGTH - 3)}_99`;
}

export async function GET() {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const db = await getDb();
  const profile = await db.collection("profiles").findOne({ user_id: authState.userId });

  if (!profile) {
    return NextResponse.json({ profile: null });
  }

  if (profile.is_deleted) {
    await permanentlyDeleteUserData(db, authState.userId as string);
    return NextResponse.json({ profile: null, deleted: true });
  }

  return NextResponse.json({ profile: serializeDoc(profile) });
}

export async function POST(request: Request) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const parsed = await readJsonBody<{ username?: string; displayName?: string }>(request);
  if (parsed.error) return parsed.error;

  const username = normalizeUsername(parsed.body?.username || "");
  const displayName = (parsed.body?.displayName || "").trim() || username;

  if (!username || username.length < USERNAME_MIN_LENGTH) {
    return badRequest("Username must be at least 3 characters");
  }

  const db = await getDb();
  const profiles = db.collection("profiles");
  const resolvedUsername = await resolveUniqueUsername(profiles, username, authState.userId as string);
  const now = new Date();

  await profiles.updateOne(
    { user_id: authState.userId },
    {
      $set: {
        username: resolvedUsername,
        display_name: displayName,
        updated_at: now,
      },
      $setOnInsert: {
        user_id: authState.userId,
        bio: "",
        avatar_url: null,
        status: "online",
        created_at: now,
      },
    },
    { upsert: true }
  );

  const profile = await profiles.findOne({ user_id: authState.userId });
  return NextResponse.json({
    profile: profile ? serializeDoc(profile) : null,
    usernameAdjusted: resolvedUsername !== username,
  });
}

export async function PATCH(request: Request) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const parsed = await readJsonBody<{ displayName?: unknown; bio?: unknown }>(request);
  if (parsed.error) return parsed.error;

  const body = parsed.body || {};
  const updates: Record<string, unknown> = { updated_at: new Date() };

  if (typeof body.displayName === "string") {
    const trimmedDisplayName = body.displayName.trim();
    if (!trimmedDisplayName) {
      return badRequest("Display name cannot be empty");
    }
    updates.display_name = trimmedDisplayName;
  }

  if (typeof body.bio === "string") {
    updates.bio = body.bio;
  }

  const db = await getDb();
  await db.collection("profiles").updateOne(
    { user_id: authState.userId },
    { $set: updates }
  );

  const updatedProfile = await db.collection("profiles").findOne({ user_id: authState.userId });
  return NextResponse.json({ profile: updatedProfile ? serializeDoc(updatedProfile) : null, updated_at: toIsoDate(new Date()) });
}

export async function DELETE() {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const userId = authState.userId as string;
  const db = await getDb();
  await permanentlyDeleteUserData(db, userId);

  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
  } catch (error) {
    console.error("Failed to delete Clerk account", error);
    return NextResponse.json(
      {
        error: "Your app data was deleted, but account deletion failed. Please try again.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    deleted: true,
    account_deleted: true,
    deleted_at: toIsoDate(new Date()),
  });
}
