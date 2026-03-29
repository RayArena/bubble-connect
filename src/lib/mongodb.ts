import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "";

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let mongoClientPromise: Promise<MongoClient> | null = global._mongoClientPromise || null;

if (process.env.NODE_ENV !== "production") {
  global._mongoClientPromise = mongoClientPromise || undefined;
}

export async function getDb() {
  if (!uri) {
    throw new Error("Missing MONGODB_URI environment variable");
  }

  if (!mongoClientPromise) {
    mongoClientPromise = new MongoClient(uri).connect();
    if (process.env.NODE_ENV !== "production") {
      global._mongoClientPromise = mongoClientPromise;
    }
  }

  const client = await mongoClientPromise;
  const dbName = process.env.MONGODB_DB_NAME || "bubble_connect";
  return client.db(dbName);
}
