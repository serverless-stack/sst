import express from "express";

const PORT = 80;

const app = express();

app.get("/", async (req, res) => {
  res.send("Hello World");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
