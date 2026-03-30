import { NextResponse } from "next/server";
import { requireUserId, serializeDoc } from "@/lib/api-helpers";
import { getDb } from "@/lib/mongodb";
import { permanentlyDeleteUserData, recoverProfileDeletion } from "@/lib/user-lifecycle";

export async function POST() {
  const authState = await requireUserId({ allowDeletedProfile: true });
  if (authState.error) return authState.error;

  const db = await getDb();
  const result = await recoverProfileDeletion(db, authState.userId as string);

  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (result.reason === "expired") {
      await permanentlyDeleteUserData(db, authState.userId as string);
      return NextResponse.json(
        { error: "Recovery period has ended and this profile has been permanently deleted." },
        { status: 410 }
      );
    }
  }

  const profile = await db.collection("profiles").findOne({ user_id: authState.userId });
  return NextResponse.json({
    ok: true,
    recovered: result.ok ? result.recovered : false,
    profile: profile ? serializeDoc(profile) : null,
  });
}
