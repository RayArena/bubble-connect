import type { Server as HttpServer } from "http";
import type { Socket } from "net";
import type { NextApiRequest, NextApiResponse } from "next";
import type { Server as SocketIOServer } from "socket.io";
import { initializeSocketServer } from "@/lib/socket-server";

type SocketServer = HttpServer & {
  io?: SocketIOServer;
};

type SocketWithServer = Socket & {
  server: SocketServer;
};

type NextApiResponseWithSocket = NextApiResponse & {
  socket: SocketWithServer;
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(_req: NextApiRequest, res: NextApiResponseWithSocket) {
  initializeSocketServer(res.socket.server);
  res.status(200).json({ ok: true });
}
