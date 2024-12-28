import { Resource } from "sst";

console.log({
  sdk: Resource.MyBucket.name,
  env: process.env.SST_RESOURCE_MyBucket,
});
