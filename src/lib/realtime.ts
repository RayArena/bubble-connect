import { publishRedis } from "@/lib/upstash-redis";
import type { RealtimeEnvelope, RealtimeEvent } from "@/types/realtime";

export const REALTIME_CHANNEL = "realtime:events";

export function roomForUser(userId: string) {
  return `user:${userId}`;
}

export function roomForConversation(conversationId: string) {
  return `conversation:${conversationId}`;
}

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

  return publishRedis(REALTIME_CHANNEL, JSON.stringify(envelope));
}
