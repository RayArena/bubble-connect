import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getDb } from "@/lib/mongodb";
import { badRequest, requireUserId, serializeDoc, toIsoDate } from "@/lib/api-helpers";
import { permanentlyDeleteUserData } from "@/lib/user-lifecycle";

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
