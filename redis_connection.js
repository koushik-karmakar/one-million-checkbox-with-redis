import Redis from "ioredis";
import "dotenv/config";

function redisConnection() {
  const client = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      })
    : new Redis({
        host: process.env.REDIS_HOST ?? "localhost",
        port: Number(process.env.REDIS_PORT ?? 6379),
        lazyConnect: true,
      });

  client.on("error", (err) => {
    console.error("[Redis Error]", err.message);
  });

  return client;
}

export const redisPublisher = redisConnection();
export const redisSubscriber = redisConnection();
export const redisClient = redisConnection();
