import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { Resource } from 'sst'
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3 = new S3Client();

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.post('/', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'] as File;

  const params = {
    Bucket: Resource.MyBucket.name,
    ContentType: file.type,
    Key: file.name,
    Body: file,
  };
  const upload = new Upload({
    params,
    client: s3,
  });
  await upload.done();

  return c.text('File uploaded successfully.');
});

app.get('/latest', async (c) => {
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

const port = 3000
console.log(`Server is running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port
})
