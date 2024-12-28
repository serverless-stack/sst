import express from "express";
import { Resource } from "sst";
import { Cluster } from "ioredis";

const PORT = 80;

const app = express();

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

app.get("/", async (req, res) => {
  const counter = await redis.incr("counter");
  res.send(`Hit counter: ${counter}`);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
