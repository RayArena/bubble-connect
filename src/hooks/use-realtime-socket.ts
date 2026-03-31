"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth as useClerkAuth } from "@clerk/nextjs";

type SharedSocket = Socket | null;

let sharedSocket: SharedSocket = null;
let socketInitPromise: Promise<SharedSocket> | null = null;

async function getOrCreateSocket(token?: string | null) {
  if (typeof window === "undefined") {
    return null;
  }

  if (sharedSocket) {
    return sharedSocket;
  }

  if (!socketInitPromise) {
    socketInitPromise = (async () => {
      await fetch("/api/socket", { cache: "no-store" }).catch(() => null);

      const socket = io({
        path: "/api/socket",
        transports: ["websocket", "polling"],
        withCredentials: true,
        auth: token ? { token } : undefined,
      });

      sharedSocket = socket;
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
      setSocket(null);
      setConnected(false);
      return;
    }

    let mounted = true;
    let localSocket: SharedSocket = null;

    const setup = async () => {
      const token = await getToken().catch(() => null);
      const nextSocket = await getOrCreateSocket(token);
      if (!mounted || !nextSocket) return;

      localSocket = nextSocket;
      setSocket(nextSocket);
      setConnected(nextSocket.connected);

      const onConnect = () => setConnected(true);
      const onDisconnect = () => setConnected(false);

      nextSocket.on("connect", onConnect);
      nextSocket.on("disconnect", onDisconnect);

      return () => {
        nextSocket.off("connect", onConnect);
        nextSocket.off("disconnect", onDisconnect);
      };
    };

    let teardown: (() => void) | undefined;
    void setup().then((cleanup) => {
      teardown = cleanup;
    });

    return () => {
      mounted = false;
      teardown?.();

      if (localSocket && !localSocket.connected) {
        localSocket.connect();
      }
    };
  }, [getToken, userId]);

  return {
    socket,
    connected,
  };
}
