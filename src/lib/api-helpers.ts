import { auth } from "@clerk/nextjs/server";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

export function toIsoDate(value: Date | string | undefined) {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

export function serializeDoc<T>(doc: T) {
  const source = doc as T & { _id?: ObjectId; id?: unknown };
  const { _id, ...rest } = source;
  const explicitId = typeof source.id === "string" && source.id.trim() ? source.id : null;

  return {
    ...rest,
    id: explicitId || _id?.toString() || "",
  };
}

export async function requireUserId() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return {
        userId: null,
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    return { userId, error: null };
  } catch (error) {
    console.error("Auth check failed", error);
    return {
      userId: null,
      error: NextResponse.json(
        {
          error: "Authentication service is not configured correctly on the server.",
          code: "AUTH_CONFIG_ERROR",
        },
        { status: 503 }
      ),
    };
  }
}

export async function readJsonBody<T>(request: Request) {
  try {
    const body = (await request.json()) as T;
    return { body, error: null };
  } catch {
    return {
      body: null,
      error: badRequest("Invalid JSON body"),
    };
  }
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function internalServerError(error: unknown, fallbackMessage: string) {
  console.error(fallbackMessage, error);

  const message = error instanceof Error ? error.message : "Unknown error";
  const lower = message.toLowerCase();

  if (lower.includes("mongodb_uri") || lower.includes("mongo") || lower.includes("ecconn") || lower.includes("server selection")) {
    return NextResponse.json(
      {
        error: "Database is unavailable. Check MongoDB environment variables and network access.",
        code: "DB_UNAVAILABLE",
      },
      { status: 503 }
    );
  }

  if (lower.includes("clerk") || lower.includes("publishable") || lower.includes("secret key")) {
    return NextResponse.json(
      {
        error: "Authentication service is not configured correctly on the server.",
        code: "AUTH_CONFIG_ERROR",
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      error: fallbackMessage,
      code: "INTERNAL_ERROR",
    },
    { status: 500 }
  );
}
