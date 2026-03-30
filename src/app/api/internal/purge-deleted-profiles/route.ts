import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { permanentlyDeleteUserData } from "@/lib/user-lifecycle";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;

  if (!configuredSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const requestSecret = request.headers.get("x-cron-secret");
  if (!requestSecret || requestSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const now = new Date();

  const expiredProfiles = await db
    .collection("profiles")
    .find(
      {
        is_deleted: true,
        deletion_recover_until: { $lte: now },
      },
      { projection: { user_id: 1, _id: 0 } }
    )
    .toArray();

  const userIds = Array.from(
    new Set(
      expiredProfiles
        .map((profile) => (typeof profile.user_id === "string" ? profile.user_id : null))
        .filter((userId): userId is string => Boolean(userId))
    )
  );

  for (const userId of userIds) {
    await permanentlyDeleteUserData(db, userId);
  }

  return NextResponse.json({
    ok: true,
    purged_users: userIds.length,
  });
}
