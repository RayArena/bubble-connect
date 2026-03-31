import { MongoClient } from "mongodb";

function resolveMongoUri() {
  const candidates = [
    process.env.MONGODB_URI,
    process.env.MONGODB_URL,
    process.env.MONGO_URI,
    process.env.DATABASE_URL,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  const mongoUri = candidates.find((value) => value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"));
  return mongoUri || "";
}

const uri = resolveMongoUri();
const DEFAULT_DB_NAME = "bubble_connect";

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let mongoClientPromise: Promise<MongoClient> | null = global._mongoClientPromise || null;

if (process.env.NODE_ENV !== "production") {
  global._mongoClientPromise = mongoClientPromise || undefined;
}

function resetMongoClientPromise() {
  mongoClientPromise = null;
  if (process.env.NODE_ENV !== "production") {
    global._mongoClientPromise = undefined;
  }
}

function getDbNameFromUri(connectionString: string) {
  try {
    const parsed = new URL(connectionString);
    const dbName = parsed.pathname.replace(/^\//, "").trim();
    return dbName ? decodeURIComponent(dbName) : DEFAULT_DB_NAME;
  } catch {
    return DEFAULT_DB_NAME;
  }
}

async function getMongoClient() {
  if (!mongoClientPromise) {
    const timeoutMs = 10_000;
    mongoClientPromise = new MongoClient(uri, {
      // Atlas endpoints can misbehave on some VPN/IPv6 routes; prefer stable IPv4 selection.
      family: 4,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 5_000,
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
      socketTimeoutMS: timeoutMs,
    })
      .connect()
      .catch((error) => {
        // Avoid caching a rejected promise so transient network failures can recover.
        resetMongoClientPromise();
        throw error;
      });

    if (process.env.NODE_ENV !== "production") {
      global._mongoClientPromise = mongoClientPromise;
    }
  }

  return mongoClientPromise;
}

export async function getDb() {
  if (!uri) {
    throw new Error("Missing MongoDB connection string (set MONGODB_URI, MONGODB_URL, MONGO_URI, or DATABASE_URL)");
  }

  const client = await getMongoClient();
  const dbName = getDbNameFromUri(uri);
  return client.db(dbName);
}
