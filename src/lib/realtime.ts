import { publishRedis, isRedisConfigured } from "@/lib/upstash-redis";
import { REALTIME_CHANNEL, roomForUser, roomForConversation } from "@/lib/realtime-constants";
import { getGlobalIo } from "@/lib/socket-server";
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

  // Prefer Redis publish when configured (works across processes/instances)
  if (isRedisConfigured()) {
    return publishRedis(REALTIME_CHANNEL, JSON.stringify(envelope));
  }

  // Local in-process fallback: emit directly to Socket.IO if available
  try {
    const io = getGlobalIo();
    if (!io) return false;

    uniqueRooms.forEach((room) => {
      io.to(room).emit("realtime:event", event);
    });

    return true;
  } catch (error) {
    console.error("Local realtime emit failed", error);
    return false;
  }
}
