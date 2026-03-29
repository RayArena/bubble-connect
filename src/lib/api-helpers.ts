import { auth } from "@clerk/nextjs/server";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

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

export async function requireUserId() {
  const { userId } = await auth();
  if (!userId) {
    return {
      userId: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { userId, error: null };
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
