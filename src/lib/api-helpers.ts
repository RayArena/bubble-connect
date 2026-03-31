import { auth, verifyToken } from "@clerk/nextjs/server";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

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
    // Fallback: if auth() fails due middleware context/runtime issues, verify session cookie directly.
    try {
      const cookieStore = await cookies();
      const sessionToken = cookieStore.get("__session")?.value;
      const secretKey = process.env.CLERK_SECRET_KEY;

      if (sessionToken && secretKey) {
        const verified = await verifyToken(sessionToken, {
          secretKey,
        });

        const fallbackUserId = typeof verified.sub === "string" ? verified.sub : null;
        if (fallbackUserId) {
          return { userId: fallbackUserId, error: null };
        }
      }
    } catch (fallbackError) {
      console.error("Auth fallback token verification failed", fallbackError);
    }

    console.error("Auth check failed", error);

    const message = error instanceof Error ? error.message : "Unknown auth error";
    const lower = message.toLowerCase();

    if (lower.includes("middleware") || lower.includes("request") || lower.includes("auth()")) {
      return {
        userId: null,
        error: NextResponse.json(
          {
            error: "Authentication context is unavailable for this request. Ensure middleware is running for API routes.",
            code: "AUTH_CONTEXT_ERROR",
          },
          { status: 503 }
        ),
      };
    }

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
