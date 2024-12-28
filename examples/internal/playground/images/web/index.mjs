import express from "express";
import { Resource } from "sst";

const PORT = 80;

const app = express();

app.get("/", async (req, res) => {
  res.send(
    JSON.stringify({
      sdk: Resource.MyBucket.name,
      env: process.env.SST_RESOURCE_MyBucket,
    })
  );
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
