import multer from "multer";
import express from "express";
import { Resource } from "sst";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const PORT = 80;

const app = express();
const s3 = new S3Client({});
const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (req, res) => {
  res.send("Hello World!")
});

app.post("/", upload.single("file"), async (req, res) => {
  const file = req.file;
  const params = {
    Bucket: Resource.MyBucket.name,
    ContentType: file.mimetype,
    Key: file.originalname,
    Body: file.buffer,
  };

  const upload = new Upload({
    params,
    client: s3,
  });

  await upload.done();

  res.status(200).send("File uploaded successfully.");
});

app.get("/latest", async (req, res) => {
  const objects = await s3.send(
    new ListObjectsV2Command({
      Bucket: Resource.MyBucket.name,
    }),
  );

  const latestFile = objects.Contents.sort(
    (a, b) => b.LastModified - a.LastModified,
  )[0];

  const command = new GetObjectCommand({
    Key: latestFile.Key,
    Bucket: Resource.MyBucket.name,
  });
  const url = await getSignedUrl(s3, command);

  res.redirect(url);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
