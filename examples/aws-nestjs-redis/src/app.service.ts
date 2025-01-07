import { Injectable } from '@nestjs/common';
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

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  async getCounter(): Promise<number> {
    return await redis.incr("counter");
  }
}
