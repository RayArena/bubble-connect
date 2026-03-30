import { auth } from "@clerk/nextjs/server";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export function toIsoDate(value: Date | string | undefined) {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

export function serializeDoc<T>(doc: T) {
  const source = doc as T & { _id?: ObjectId };
  const { _id, ...rest } = source;
  return {
    ...rest,
    id: _id?.toString() || "",
  };
}

interface RequireUserIdOptions {
  allowDeletedProfile?: boolean;
}

export async function requireUserId(options: RequireUserIdOptions = {}) {
  const { userId } = await auth();
  if (!userId) {
    return {
      userId: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!options.allowDeletedProfile) {
    const db = await getDb();
    const profile = await db
      .collection("profiles")
      .findOne({ user_id: userId }, { projection: { is_deleted: 1, deletion_recover_until: 1 } });

    if (profile?.is_deleted) {
      return {
        userId: null,
        error: NextResponse.json(
          {
            error: "Profile is scheduled for deletion. Recover your profile to continue.",
            recover_until: profile.deletion_recover_until || null,
          },
          { status: 403 }
        ),
      };
    }
  }

  return { userId, error: null };
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
