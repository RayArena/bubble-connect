import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { badRequest, requireUserId, serializeDoc, toIsoDate } from "@/lib/api-helpers";
import { isRecoveryExpired, permanentlyDeleteUserData, scheduleProfileDeletion } from "@/lib/user-lifecycle";

export async function GET() {
  const authState = await requireUserId({ allowDeletedProfile: true });
  if (authState.error) return authState.error;

  const db = await getDb();
  const profile = await db.collection("profiles").findOne({ user_id: authState.userId });

  if (!profile) {
    return NextResponse.json({ profile: null });
  }

  if (profile.is_deleted && isRecoveryExpired(profile.deletion_recover_until)) {
    await permanentlyDeleteUserData(db, authState.userId as string);
    return NextResponse.json({ profile: null, deleted: true });
  }

  return NextResponse.json({ profile: serializeDoc(profile) });
}

export async function POST(request: Request) {
  const authState = await requireUserId({ allowDeletedProfile: true });
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

  const existingProfile = await profiles.findOne(
    { user_id: authState.userId },
    { projection: { is_deleted: 1 } }
  );

  if (existingProfile?.is_deleted) {
    return NextResponse.json(
      { error: "Profile is scheduled for deletion. Recover it before making changes." },
      { status: 403 }
    );
  }

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
  const authState = await requireUserId({ allowDeletedProfile: true });
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
  const profile = await db
    .collection("profiles")
    .findOne({ user_id: authState.userId }, { projection: { is_deleted: 1 } });

  if (profile?.is_deleted) {
    return NextResponse.json(
      { error: "Profile is scheduled for deletion. Recover it before making changes." },
      { status: 403 }
    );
  }

  await db.collection("profiles").updateOne(
    { user_id: authState.userId },
    { $set: updates }
  );

  const updatedProfile = await db.collection("profiles").findOne({ user_id: authState.userId });
  return NextResponse.json({ profile: updatedProfile ? serializeDoc(updatedProfile) : null, updated_at: toIsoDate(new Date()) });
}

export async function DELETE() {
  const authState = await requireUserId({ allowDeletedProfile: true });
  if (authState.error) return authState.error;

  const db = await getDb();
  const result = await scheduleProfileDeletion(db, authState.userId as string);

  if (!result.matched) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    recover_until: toIsoDate(result.recoverUntil),
    recovery_days: 30,
  });
}
