import express from "express";

const PORT = 80;

const app = express();

app.get("/", (_req, res) => {
  res.send(`Hello from http://localhost:${PORT}`)
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
