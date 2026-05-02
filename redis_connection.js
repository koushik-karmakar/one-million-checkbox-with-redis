import Redis from "ioredis";
function redisCnnection() {
  return new Redis({
    host: "localhost",
    port: 6379,
  });
}
const redisPublisher = redisCnnection();
const redisSubscriber = redisCnnection();
const redisClient = redisCnnection();
export { redisPublisher, redisSubscriber, redisClient };
