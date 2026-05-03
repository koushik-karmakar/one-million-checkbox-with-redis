import http from "node:http";
import path from "node:path";
import express from "express";
import { Server } from "socket.io";
import { stat } from "node:fs";
import {
  redisSubscriber,
  redisPublisher,
  redisClient,
} from "./redis_connection.js";

(async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // ===============  socket connection setup=================
  const io = new Server();
  io.attach(server);
  const CHECKBOX_SIZE = 100;
  const CHECKBOX_KEY = "checkbox-state-key";
  // const state = {
  //   checkbox: new Array(CHECKBOX_SIZE).fill(false),
  // };
  //  =================== socker handler=================
  io.on("connection", (socket) => {
    console.log("a user connected with id: ", socket.id);

    socket.on("client:checkbox-change", async (data) => {
      console.log({ ...data, socketId: socket.id });

      // geting state from redis
      const isRedisState = await redisClient.get(CHECKBOX_KEY);
      if (isRedisState) {
        const remoteData = JSON.parse(isRedisState);
        remoteData[data.index] = data.checked;
        await redisClient.set(CHECKBOX_KEY, JSON.stringify(remoteData));
      } else {
        await redisClient.set(
          CHECKBOX_KEY,
          JSON.stringify(new Array(CHECKBOX_SIZE).fill(false)),
        );
      }
      await redisPublisher.publish(
        "internal:checkbox-change",
        JSON.stringify({ ...data, socketId: socket.id }),
      );
      await redisSubscriber.subscribe("internal:checkbox-change");
      await redisSubscriber.on("message", (channel, message) => {
        if (channel === "internal:checkbox-change") {
          const data = JSON.parse(message);
          io.emit("server:checkbox-change", { ...data, socketId: socket.id });
        }
      });
    });
  });

  // ===============express setup==============
  app.use(express.static(path.resolve("./public")));
  app.get("/health", (req, res) => {
    res.status(200).send("Server is healthy");
  });
  app.get("/state", async (req, res) => {
    const isRedisState = await redisClient.get(CHECKBOX_KEY);
    if (isRedisState) {
      const data = JSON.parse(isRedisState);
      return res.status(200).json({ checkbox: data });
    }

    return res
      .status(200)
      .json({ checkbox: new Array(CHECKBOX_SIZE).fill(false) });
  });
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
})();
