import express from "express";

const PORT = 8080;

const app = express();

app.get("/", async (req, res) => {
  res.send("I'm a sidecar");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
