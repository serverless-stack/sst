import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { Resource } from "sst";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const s3 = new S3Client();

const app = new Hono();

app.get("/", async (c) => {
  const command = new PutObjectCommand({
    Key: crypto.randomUUID(),
    Bucket: Resource.MyBucket.name,
  });

  return c.text(await getSignedUrl(s3, command));
});

app.get("/latest", async (c) => {
  const objects = await s3.send(
    new ListObjectsV2Command({
      Bucket: Resource.MyBucket.name,
    }),
  );

  const latestFile = objects.Contents!.sort(
    (a, b) =>
      (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0),
  )[0];

  const command = new GetObjectCommand({
    Key: latestFile.Key,
    Bucket: Resource.MyBucket.name,
  });

  return c.redirect(await getSignedUrl(s3, command));
});

export const handler = handle(app);
