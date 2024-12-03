import { Resource } from "sst";
import { Cluster } from "ioredis";

const redis = new Cluster(
  [{ host: Resource.MyRedis.host, port: Resource.MyRedis.port }],
  {
    dnsLookup: (address, callback) => callback(null, address),
    redisOptions: {
      tls: {},
      username: Resource.MyRedis.username,
      password: Resource.MyRedis.password,
    },
  }
);

const server = Bun.serve({
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/" && req.method === "GET") {
      const counter = await redis.incr("counter");
      return new Response(`Hit counter: ${counter}`);
    }

    return new Response("404!");
  },
});

console.log(`Listening on ${server.url}`);
