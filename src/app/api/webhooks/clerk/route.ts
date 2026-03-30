import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook, type WebhookEvent } from "@clerk/nextjs/webhooks";
import { getDb } from "@/lib/mongodb";
import { permanentlyDeleteUserData } from "@/lib/user-lifecycle";

export const runtime = "nodejs";

type ClerkUserData = {
  id: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  email_addresses?: Array<{
    id?: string;
    email_address?: string;
  }>;
  primary_email_address_id?: string | null;
};

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 30;

function sanitizeUsername(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, USERNAME_MAX_LENGTH);
}

function fallbackUsername(userId: string) {
  const suffix = sanitizeUsername(userId).slice(-12) || "user";
  return `user_${suffix}`.slice(0, USERNAME_MAX_LENGTH);
}

function getPrimaryEmail(user: ClerkUserData) {
  if (!Array.isArray(user.email_addresses) || !user.email_addresses.length) {
    return null;
  }

  if (user.primary_email_address_id) {
    const primary = user.email_addresses.find((email) => email.id === user.primary_email_address_id);
    if (primary?.email_address) {
      return primary.email_address;
    }
  }

  return user.email_addresses[0]?.email_address || null;
}

function buildDisplayName(user: ClerkUserData, username: string) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;

  if (user.first_name?.trim()) return user.first_name.trim();

  const primaryEmail = getPrimaryEmail(user);
  if (primaryEmail) {
    const localPart = primaryEmail.split("@")[0];
    if (localPart) return localPart;
  }

  return username;
}

async function resolveUniqueUsername(desired: string, userId: string) {
  const db = await getDb();
  const profiles = db.collection("profiles");

  const base = desired.length >= USERNAME_MIN_LENGTH ? desired : fallbackUsername(userId);
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

  return fallbackUsername(userId);
}

async function upsertProfileForUser(user: ClerkUserData) {
  const db = await getDb();
  const profiles = db.collection("profiles");

  const existingProfile = await profiles.findOne({ user_id: user.id }, { projection: { username: 1 } });
  const emailLocalPart = getPrimaryEmail(user)?.split("@")[0] || "";
  const desiredUsername = sanitizeUsername(
    user.username || existingProfile?.username || emailLocalPart || fallbackUsername(user.id)
  );
  const username = await resolveUniqueUsername(desiredUsername, user.id);
  const displayName = buildDisplayName(user, username);
  const now = new Date();

  await profiles.updateOne(
    { user_id: user.id },
    {
      $set: {
        username,
        display_name: displayName,
        avatar_url: user.image_url || null,
        updated_at: now,
      },
      $setOnInsert: {
        user_id: user.id,
        bio: "",
        status: "online",
        created_at: now,
      },
    },
    { upsert: true }
  );
}

async function deleteProfileForUser(userId: string) {
  const db = await getDb();
  await permanentlyDeleteUserData(db, userId);
}

export async function POST(request: NextRequest) {
  let event: WebhookEvent;

  try {
    event = await verifyWebhook(request);
  } catch (error) {
    console.error("Clerk webhook verification failed", error);
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  try {
    if (event.type === "user.created" || event.type === "user.updated") {
      await upsertProfileForUser(event.data as ClerkUserData);
    }

    if (event.type === "user.deleted") {
      const userId = (event.data as { id?: string } | null)?.id;
      if (userId) {
        await deleteProfileForUser(userId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`Failed to process Clerk webhook event: ${event.type}`, error);
    return NextResponse.json({ error: "Failed to process webhook event" }, { status: 500 });
  }
}
