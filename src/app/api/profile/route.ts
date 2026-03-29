import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { badRequest, requireUserId, serializeDoc, toIsoDate } from "@/lib/api-helpers";

export async function GET() {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const db = await getDb();
  const profile = await db.collection("profiles").findOne({ user_id: authState.userId });

  if (!profile) {
    return NextResponse.json({ profile: null });
  }

  return NextResponse.json({ profile: serializeDoc(profile) });
}

export async function POST(request: Request) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const body = await request.json();
  const username = body.username?.trim().toLowerCase();
  const displayName = body.displayName?.trim();

  if (!username || username.length < 3) {
    return badRequest("Username must be at least 3 characters");
  }

  if (!displayName) {
    return badRequest("Display name is required");
  }

  const db = await getDb();
  const profiles = db.collection("profiles");
  const now = new Date();

  const existingByUsername = await profiles.findOne({ username, user_id: { $ne: authState.userId } });
  if (existingByUsername) {
    return badRequest("Username already taken");
  }

  await profiles.updateOne(
    { user_id: authState.userId },
    {
      $set: {
        username,
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
  return NextResponse.json({ profile: profile ? serializeDoc(profile) : null });
}

export async function PATCH(request: Request) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const body = await request.json();
  const updates: Record<string, unknown> = { updated_at: new Date() };

  if (typeof body.displayName === "string") {
    updates.display_name = body.displayName.trim();
  }

  if (typeof body.bio === "string") {
    updates.bio = body.bio;
  }

  const db = await getDb();
  await db.collection("profiles").updateOne(
    { user_id: authState.userId },
    { $set: updates }
  );

  const profile = await db.collection("profiles").findOne({ user_id: authState.userId });
  return NextResponse.json({ profile: profile ? serializeDoc(profile) : null, updated_at: toIsoDate(new Date()) });
}
