#!/usr/bin/env node

"use strict";

const path = require("path");
const fs = require("fs-extra");
const spawn = require("cross-spawn");
const argv = require("minimist")(process.argv.slice(2), { "--": true });

function getSstAppPath() {
  // Select a starting dir or default to current directory, then traverse up directory until finds `sst.json`
  let curPath = argv.path ? path.resolve(process.cwd(), argv.path) : process.cwd();
  do {
    if (fs.existsSync(path.join(curPath, "sst.json"))) {
      return path.resolve(curPath);
    }
    curPath = `${curPath}/..`;
  } while (path.resolve(curPath) !== path.resolve("/"));
}

// Get SST app path
const sstAppPath = getSstAppPath();
if (!sstAppPath) {
  console.error("sst-env: Cannot find an SST app in the parent directories");
  process.exit(1);
}

// Get environment outputs path
const environmentOutputsPath = path.join(
  sstAppPath,
  ".build",
  "static-site-environment-output-values.json"
);
if (!fs.existsSync(environmentOutputsPath)) {
  console.error(
    `sst-env: Cannot find the SST outputs file in ${sstAppPath}. Make sure "sst start" is running.`
  );
  process.exit(1);
}

// Get environment
const siteEnvironments = fs.readJsonSync(environmentOutputsPath);
const environment = siteEnvironments.find(
  ({ path: sitePath }) => process.cwd() === path.resolve(sstAppPath, sitePath)
);
if (!environment) {
  console.error(
    `sst-env: Cannot find matching SST environment outputs in ${environmentOutputsPath}. Ensure the StaticSite points to ${process.cwd()}`
  );
  process.exit(1);
}

if (argv["--"] && argv["--"].length) {
  spawn(argv["--"][0], argv["--"].slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      ...environment.environmentOutputs,
    },
  }).on("exit", function (exitCode) {
    process.exit(exitCode);
  });
}
