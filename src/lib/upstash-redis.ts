import { createClient, type RedisClientType } from "redis";

declare global {
  var _redisClientPromise: Promise<RedisClientType | null> | undefined;
}

let redisClientPromise: Promise<RedisClientType | null> | null = global._redisClientPromise || null;

if (process.env.NODE_ENV !== "production") {
  global._redisClientPromise = redisClientPromise || undefined;
}

export function getRedisUrl() {
  const candidates = [process.env.UPSTASH_REDIS_URL, process.env.REDIS_URL]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return candidates.find((value) => value.startsWith("redis://") || value.startsWith("rediss://")) || "";
}

export function isRedisConfigured() {
  return Boolean(getRedisUrl());
}

export async function getRedisClient() {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return null;
  }

  if (!redisClientPromise) {
    const client = createClient({ url: redisUrl });
    client.on("error", (error) => {
      console.error("Redis client error", error);
    });

    redisClientPromise = client
      .connect()
      .then(() => client)
      .catch((error) => {
        redisClientPromise = null;
        if (process.env.NODE_ENV !== "production") {
          global._redisClientPromise = undefined;
        }
        console.error("Redis connect failed", error);
        return null;
      });

    if (process.env.NODE_ENV !== "production") {
      global._redisClientPromise = redisClientPromise;
    }
  }

  return redisClientPromise;
}

export async function publishRedis(channel: string, payload: string) {
  try {
    const client = await getRedisClient();
    if (!client) return false;
    await client.publish(channel, payload);
    return true;
  } catch (error) {
    console.error("Redis publish failed", error);
    return false;
  }
}
