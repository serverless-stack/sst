const { runStartCommand } = require("../helpers");
const fs = require("fs");
const path = require("path");

test("sst-env-outputs-file-not-exist", async () => {
  const result = await runStartCommand(__dirname);

  expect(result).toContain(
    "sst-env: Waiting for sst.json to be created. Retry 5"
  );
}, 6000);
