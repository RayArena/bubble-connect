import { verifyToken } from "@clerk/nextjs/server";
import { parse as parseCookieHeader } from "cookie";
import type { Server as HttpServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { createClient } from "redis";
import { getDb } from "@/lib/mongodb";
import { REALTIME_CHANNEL, roomForConversation, roomForUser } from "@/lib/realtime-constants";
import { getRedisUrl } from "@/lib/upstash-redis";
import type { RealtimeEnvelope } from "@/types/realtime";

interface SocketServerState extends HttpServer {
  io?: SocketIOServer;
  redisSubscriber?: ReturnType<typeof createClient>;
}

let globalIo: SocketIOServer | undefined;

export function getGlobalIo() {
  return globalIo;
}

interface SocketWithUser extends Socket {
  data: {
    userId?: string;
  };
}

async function resolveSocketUserId(socket: Socket) {
  const authValue = socket.handshake.auth;
  const authToken = typeof authValue?.token === "string" ? authValue.token : "";
  const headerCookie =
    typeof socket.handshake.headers.cookie === "string" ? socket.handshake.headers.cookie : "";
  const parsedCookies = headerCookie ? parseCookieHeader(headerCookie) : {};
  const sessionToken = authToken || parsedCookies.__session || "";
  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!sessionToken || !secretKey) {
    return null;
  }

  try {
    const verified = await verifyToken(sessionToken, { secretKey });
    return typeof verified.sub === "string" ? verified.sub : null;
  } catch {
    return null;
  }
}

async function subscribeConversation(socket: SocketWithUser, conversationId: string) {
  const userId = socket.data.userId;
  if (!userId || !conversationId) return false;

  const db = await getDb();
  const membership = await db.collection("conversation_members").findOne({
    conversation_id: conversationId,
    user_id: userId,
  });

  if (!membership) {
    return false;
  }

  socket.join(roomForConversation(conversationId));
  return true;
}

async function initializeRedisSubscriber(io: SocketIOServer, server: SocketServerState) {
  if (server.redisSubscriber) {
    return;
  }

  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return;
  }

  try {
    const subscriber = createClient({ url: redisUrl });
    subscriber.on("error", (error) => {
      console.error("Redis subscriber error", error);
    });

    await subscriber.connect();
    await subscriber.subscribe(REALTIME_CHANNEL, (payload: string) => {
      try {
        const envelope = JSON.parse(payload) as RealtimeEnvelope;
        if (!envelope?.event || !Array.isArray(envelope.rooms) || !envelope.rooms.length) {
          return;
        }

        envelope.rooms.forEach((room) => {
          if (typeof room === "string" && room.trim()) {
            io.to(room).emit("realtime:event", envelope.event);
          }
        });
      } catch (error) {
        console.error("Failed to parse realtime envelope", error);
      }
    });

    server.redisSubscriber = subscriber;
  } catch (error) {
    console.error("Redis subscribe bootstrap failed", error);
  }
}

export function initializeSocketServer(server: HttpServer) {
  const socketServer = server as SocketServerState;
  if (socketServer.io) {
    return socketServer.io;
  }

  const io = new SocketIOServer(server, {
    path: "/api/socket",
    transports: ["websocket", "polling"],
    cors: {
      origin: true,
      credentials: true,
    },
  });

  io.use(async (incoming, next) => {
    const socket = incoming as SocketWithUser;
    const userId = await resolveSocketUserId(socket);

    if (!userId) {
      next(new Error("Unauthorized"));
      return;
    }

    socket.data.userId = userId;
    next();
  });

  io.on("connection", (incoming) => {
    const socket = incoming as SocketWithUser;
    const userId = socket.data.userId;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    socket.join(roomForUser(userId));

    socket.on("conversation:subscribe", async (conversationId: string, ack?: (result: { ok: boolean }) => void) => {
      const ok = await subscribeConversation(socket, conversationId);
      ack?.({ ok });
    });

    socket.on("conversation:unsubscribe", (conversationId: string) => {
      socket.leave(roomForConversation(conversationId));
    });
  });

  socketServer.io = io;
  globalIo = io;
  void initializeRedisSubscriber(io, socketServer);
  return io;
}
