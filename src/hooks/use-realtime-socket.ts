"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth as useClerkAuth } from "@clerk/nextjs";

type SharedSocket = Socket | null;

let sharedSocket: SharedSocket = null;
let socketInitPromise: Promise<SharedSocket> | null = null;
let sharedSocketUserId: string | null = null;

function shouldForcePollingTransport() {
  if (typeof window === "undefined") {
    return false;
  }

  const forcedByEnv = process.env.NEXT_PUBLIC_SOCKET_TRANSPORT === "polling";
  const hostedOnVercel = window.location.hostname.endsWith("vercel.app");
  return forcedByEnv || hostedOnVercel;
}

async function getOrCreateSocket(token?: string | null, userId?: string | null) {
  if (typeof window === "undefined") {
    return null;
  }

  if (sharedSocket && sharedSocketUserId && userId && sharedSocketUserId !== userId) {
    sharedSocket.disconnect();
    sharedSocket = null;
    sharedSocketUserId = null;
  }

  if (sharedSocket) {
    if (token) {
      sharedSocket.auth = { token };
    }
    return sharedSocket;
  }

  if (!socketInitPromise) {
    socketInitPromise = (async () => {
      await fetch("/api/socket", { cache: "no-store" }).catch(() => null);

      const forcePolling = shouldForcePollingTransport();

      const socket = io({
        path: "/api/socket",
        transports: forcePolling ? ["polling"] : ["websocket", "polling"],
        upgrade: !forcePolling,
        withCredentials: true,
        auth: token ? { token } : undefined,
      });

      sharedSocket = socket;
      sharedSocketUserId = userId || null;
      return socket;
    })().finally(() => {
      socketInitPromise = null;
    });
  }

  return socketInitPromise;
}

export function useRealtimeSocket() {
  const { getToken, userId } = useClerkAuth();
  const [socket, setSocket] = useState<SharedSocket>(sharedSocket);
  const [connected, setConnected] = useState(sharedSocket?.connected || false);

  useEffect(() => {
    if (!userId) {
      if (sharedSocket) {
        sharedSocket.disconnect();
      }
      sharedSocket = null;
      sharedSocketUserId = null;
      socketInitPromise = null;
      setSocket(null);
      setConnected(false);
      return;
    }

    let mounted = true;
    let cleanupListeners: (() => void) | undefined;

    const setup = async () => {
      const token = await getToken().catch(() => null);
      const nextSocket = await getOrCreateSocket(token, userId);
      if (!mounted || !nextSocket) return;

      if (token) {
        nextSocket.auth = { token };
      }

      setSocket(nextSocket);
      setConnected(nextSocket.connected);

      const onConnect = () => setConnected(true);
      const onDisconnect = () => setConnected(false);

      nextSocket.on("connect", onConnect);
      nextSocket.on("disconnect", onDisconnect);

      cleanupListeners = () => {
        nextSocket.off("connect", onConnect);
        nextSocket.off("disconnect", onDisconnect);
      };

      if (!nextSocket.connected) {
        nextSocket.connect();
      }
    };

    void setup();

    return () => {
      mounted = false;
      cleanupListeners?.();
    };
  }, [getToken, userId]);

  return {
    socket,
    connected,
  };
}
