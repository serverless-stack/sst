import { Hono } from "hono";
import { Resource } from "sst";
import { Cluster } from "ioredis";
import { serve } from "@hono/node-server";

const redis = new Cluster(
  [{ host: Resource.MyRedis.host, port: Resource.MyRedis.port }],
  {
    dnsLookup: (address, callback) => callback(null, address),
    redisOptions: {
      tls: {},
      username: Resource.MyRedis.username,
      password: Resource.MyRedis.password,
    },
  },
);

const app = new Hono();

app.get("/", async (c) => {
  const counter = await redis.incr("counter");
  return c.text(`Hit counter: ${counter}`);
});

const port = 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
