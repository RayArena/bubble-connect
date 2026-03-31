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

function fallbackUsername(userId: string) {
  const suffix = normalizeUsername(userId).slice(-12) || "user";
  return `user_${suffix}`.slice(0, USERNAME_MAX_LENGTH);
}

function getEmailLocalPart(email: string | null | undefined) {
  if (!email) return "";
  return email.split("@")[0] || "";
}

async function getClerkProfileSeed(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);

    const primaryEmail = user.emailAddresses.find(
      (email) => email.id === user.primaryEmailAddressId
    )?.emailAddress || user.emailAddresses[0]?.emailAddress;

    const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return {
      username: user.username || null,
      emailLocalPart: getEmailLocalPart(primaryEmail),
      displayName: displayName || user.firstName || getEmailLocalPart(primaryEmail) || null,
    };
  } catch {
    return {
      username: null,
      emailLocalPart: "",
      displayName: null,
    };
  }
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

async function upsertProfileForUser(
  profiles: Collection<Document>,
  userId: string,
  preferred: { username?: string; displayName?: string }
) {
  const clerkSeed = await getClerkProfileSeed(userId);
  const requestedUsername = normalizeUsername(preferred.username || "");
  const clerkUsername = normalizeUsername(clerkSeed.username || "");
  const clerkEmailUsername = normalizeUsername(clerkSeed.emailLocalPart || "");

  const usernameSeed =
    (requestedUsername.length >= USERNAME_MIN_LENGTH && requestedUsername) ||
    (clerkUsername.length >= USERNAME_MIN_LENGTH && clerkUsername) ||
    (clerkEmailUsername.length >= USERNAME_MIN_LENGTH && clerkEmailUsername) ||
    fallbackUsername(userId);

  const resolvedUsername = await resolveUniqueUsername(profiles, usernameSeed, userId);
  const displayName =
    (preferred.displayName || "").trim() ||
    (clerkSeed.displayName || "").trim() ||
    resolvedUsername;

  const now = new Date();
  await profiles.updateOne(
    { user_id: userId },
    {
      $set: {
        username: resolvedUsername,
        display_name: displayName,
        updated_at: now,
      },
      $setOnInsert: {
        user_id: userId,
        bio: "",
        avatar_url: null,
        status: "online",
        created_at: now,
      },
    },
    { upsert: true }
  );

  const profile = await profiles.findOne({ user_id: userId });
  return {
    profile,
    usernameAdjusted: resolvedUsername !== requestedUsername,
  };
}

export async function GET() {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const db = await getDb();
  const profiles = db.collection("profiles");
  const profile = await profiles.findOne({ user_id: authState.userId });

  if (!profile) {
    const bootstrapped = await upsertProfileForUser(profiles, authState.userId as string, {});
    return NextResponse.json({
      profile: bootstrapped.profile ? serializeDoc(bootstrapped.profile) : null,
      recovered: true,
    });
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

  const db = await getDb();
  const profiles = db.collection("profiles");
  const upserted = await upsertProfileForUser(profiles, authState.userId as string, {
    username: parsed.body?.username,
    displayName: parsed.body?.displayName,
  });

  return NextResponse.json({
    profile: upserted.profile ? serializeDoc(upserted.profile) : null,
    usernameAdjusted: upserted.usernameAdjusted,
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
  const profiles = db.collection("profiles");

  const existing = await profiles.findOne({ user_id: authState.userId });
  if (!existing) {
    await upsertProfileForUser(profiles, authState.userId as string, {});
  }

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
