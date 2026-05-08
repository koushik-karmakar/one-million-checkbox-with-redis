import "dotenv/config";
import http from "node:http";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import {
  redisSubscriber,
  redisPublisher,
  redisClient,
} from "./redis_connection.js";
import { sessionMiddleware, setupAuthRoutes, getSession } from "./auth.js";

(async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  app.use(cookieParser());
  app.use(sessionMiddleware);
  setupAuthRoutes(app);
  const CHECKBOX_SIZE = 10000;
  const CHECKBOX_KEY = "checkbox:state";
  const rateLimiter = new Map();
  const onlineUsers = new Map();

  await redisSubscriber.subscribe("checkbox:changes");
  redisSubscriber.on("message", (_channel, message) => {
    io.emit("server:checkbox-change", JSON.parse(message));
  });

  function broadcastUsers() {
    const list = Array.from(onlineUsers.values());
    io.emit("server:users-update", { count: list.length, users: list });
  }

  io.on("connection", async (socket) => {
    console.log("connected:", socket.id);
    const rawCookie = socket.handshake.headers.cookie ?? "";
    const cookies = Object.fromEntries(
      rawCookie.split(";").map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k?.trim(), decodeURIComponent(v.join("="))];
      }),
    );

    const sessionData = await getSession(cookies.checkbox_session).catch(
      () => null,
    );

    onlineUsers.set(socket.id, {
      name: sessionData?.name ?? "Guest",
      picture: sessionData?.picture ?? null,
      isAuthenticated: !!sessionData,
    });
    broadcastUsers();

    socket.on("client:checkbox-change", async (data) => {
      const user = onlineUsers.get(socket.id);

      if (!user?.isAuthenticated) {
        socket.emit("server:auth-required");
        return;
      }

      const last = rateLimiter.get(socket.id) ?? 0;
      if (Date.now() - last < 50) return;
      rateLimiter.set(socket.id, Date.now());

      const raw = await redisClient.get(CHECKBOX_KEY);
      const state = raw
        ? JSON.parse(raw)
        : new Array(CHECKBOX_SIZE).fill(false);

      state[data.index] = data.checked;
      await redisClient.set(CHECKBOX_KEY, JSON.stringify(state));

      await redisPublisher.publish(
        "checkbox:changes",
        JSON.stringify({ index: data.index, checked: data.checked }),
      );
    });

    socket.on("disconnect", () => {
      onlineUsers.delete(socket.id);
      rateLimiter.delete(socket.id);
      broadcastUsers();
    });
  });

  // ======== routes =====================
  app.use(express.static(path.resolve("./public")));

  app.get("/state", async (_req, res) => {
    const raw = await redisClient.get(CHECKBOX_KEY);
    const checkbox = raw
      ? JSON.parse(raw)
      : new Array(CHECKBOX_SIZE).fill(false);
    res.json({ checkbox });
  });

  app.get("/health", (_req, res) => res.send("OK"));

  const PORT = process.env.PORT ?? 3000;
  server.listen(PORT, () =>
    console.log(`Checkbox server running on port ${PORT}`),
  );
})();
