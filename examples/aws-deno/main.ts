import { Resource } from "sst";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client();

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/" && req.method === "GET") {
    return new Response("Hello World!");
  }

  if (url.pathname === "/" && req.method === "POST") {
    const formData: FormData = await req.formData();
    const file: File | null = formData?.get("file") as File;

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

    return new Response("File uploaded successfully.");
  }

  if (url.pathname === "/latest" && req.method === "GET") {
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
    return Response.redirect(await getSignedUrl(s3, command));
  }

  return new Response("404!");
});
