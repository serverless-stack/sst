import { Resource } from "sst";

for (let i = 0; i < 10; i++) {
  console.log(`NEW: The bucket name is ${Resource.MyBucket.name}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
