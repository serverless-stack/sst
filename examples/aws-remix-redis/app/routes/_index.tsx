import { Resource } from "sst";
import { Cluster } from "ioredis";
import { json } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

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

export const meta: MetaFunction = () => {
  return [
    { title: "New Remix App" },
    { name: "description", content: "Welcome to Remix!" },
  ];
};

export async function loader() {
  const counter = await redis.incr("counter");

  return json({ counter });
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  return (
    <h1 className="leading text-2xl font-bold text-gray-800 dark:text-gray-100">
      Hit counter: {data.counter}
    </h1>
  );
}
