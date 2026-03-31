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
  var _mongoIndexesEnsuredPromise: Promise<void> | undefined;
}

let mongoClientPromise: Promise<MongoClient> | null = global._mongoClientPromise || null;
let mongoIndexesEnsuredPromise: Promise<void> | null = global._mongoIndexesEnsuredPromise || null;

if (process.env.NODE_ENV !== "production") {
  global._mongoClientPromise = mongoClientPromise || undefined;
  global._mongoIndexesEnsuredPromise = mongoIndexesEnsuredPromise || undefined;
}

function resetMongoClientPromise() {
  mongoClientPromise = null;
  if (process.env.NODE_ENV !== "production") {
    global._mongoClientPromise = undefined;
  }
}

function resetMongoIndexesPromise() {
  mongoIndexesEnsuredPromise = null;
  if (process.env.NODE_ENV !== "production") {
    global._mongoIndexesEnsuredPromise = undefined;
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

async function ensureIndexes(client: MongoClient, dbName: string) {
  if (!mongoIndexesEnsuredPromise) {
    mongoIndexesEnsuredPromise = (async () => {
      const db = client.db(dbName);

      await Promise.all([
        db.collection("profiles").createIndexes([
          { key: { user_id: 1 }, name: "profiles_user_id" },
          { key: { username: 1 }, name: "profiles_username" },
        ]),
        db.collection("conversation_members").createIndexes([
          { key: { user_id: 1, conversation_id: 1 }, name: "conversation_members_user_conversation" },
          { key: { conversation_id: 1, user_id: 1 }, name: "conversation_members_conversation_user" },
        ]),
        db.collection("conversations").createIndexes([
          { key: { id: 1 }, name: "conversations_id" },
          { key: { updated_at: -1 }, name: "conversations_updated_at" },
        ]),
        db.collection("messages").createIndexes([
          { key: { id: 1 }, name: "messages_id" },
          { key: { conversation_id: 1, created_at: 1 }, name: "messages_conversation_created" },
        ]),
        db.collection("friendships").createIndexes([
          { key: { addressee_id: 1, status: 1, created_at: -1 }, name: "friendships_addressee_status_created" },
          { key: { requester_id: 1, addressee_id: 1 }, name: "friendships_requester_addressee" },
          { key: { addressee_id: 1, requester_id: 1 }, name: "friendships_addressee_requester" },
          { key: { status: 1, requester_id: 1, addressee_id: 1 }, name: "friendships_status_participants" },
        ]),
      ]);
    })().catch((error) => {
      // Do not block requests if index creation fails; retry on later requests.
      resetMongoIndexesPromise();
      console.error("Mongo index bootstrap failed", error);
    });

    if (process.env.NODE_ENV !== "production") {
      global._mongoIndexesEnsuredPromise = mongoIndexesEnsuredPromise;
    }
  }

  await mongoIndexesEnsuredPromise;
}

export async function getDb() {
  if (!uri) {
    throw new Error("Missing MongoDB connection string (set MONGODB_URI, MONGODB_URL, MONGO_URI, or DATABASE_URL)");
  }

  const client = await getMongoClient();
  const dbName = getDbNameFromUri(uri);
  void ensureIndexes(client, dbName);
  return client.db(dbName);
}
