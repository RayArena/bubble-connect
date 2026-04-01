import { publishRedis, isRedisConfigured } from "@/lib/upstash-redis";
import { REALTIME_CHANNEL, roomForUser, roomForConversation } from "@/lib/realtime-constants";
import type { RealtimeEnvelope, RealtimeEvent } from "@/types/realtime";

export { REALTIME_CHANNEL, roomForUser, roomForConversation };

export async function publishRealtimeEvent<TData = unknown>(
  rooms: string[],
  type: string,
  data: TData
) {
  const uniqueRooms = Array.from(new Set(rooms.filter(Boolean)));
  if (!uniqueRooms.length) return false;

  const event: RealtimeEvent<TData> = {
    type,
    data,
    ts: new Date().toISOString(),
  };

  const envelope: RealtimeEnvelope<TData> = {
    rooms: uniqueRooms,
    event,
  };

  if (!isRedisConfigured()) {
    console.error("Realtime publish skipped: UPSTASH_REDIS_URL/REDIS_URL is not configured");
    return false;
  }

  return publishRedis(REALTIME_CHANNEL, JSON.stringify(envelope));
}
