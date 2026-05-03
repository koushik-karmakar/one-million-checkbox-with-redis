import Redis from "ioredis";
import "dotenv/config";

function redisConnection() {
  if (process.env.REDIS_URL) {
    return new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
  }

  return new Redis({
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
    lazyConnect: true,
  });
}

export const redisPublisher = redisConnection();
export const redisSubscriber = redisConnection();
export const redisClient = redisConnection();
