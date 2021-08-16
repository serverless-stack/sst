const fs = require("fs");
const path = require("path");
const {
  runBuildCommand,
  clearBuildOutput,
  defaultConfig: config,
} = require("../helpers");

beforeEach(async () => {
  await clearBuildOutput(__dirname, config.buildDir);
  await clearBuildOutput(__dirname, config.buildDir, "src");
});

afterAll(async () => {
  await clearBuildOutput(__dirname, config.buildDir);
  await clearBuildOutput(__dirname, config.buildDir, "src");
});

/**
 * Test that the synth command ran successfully
 */
test("nodejs-build-bundle-copyfiles", async () => {
  await runBuildCommand(__dirname, undefined, config);

  // Directory structure
  //  /
  //    fileInRoot
  //    dirInRoot/
  //      fileInDir
  //      sub/
  //        fileInDirSub
  //    .build/
  //      cdk.out/
  //      lambda-handler-1612170130511
  //      lambda-handler-1612170130511.zip
  //      src-lambda-handler-1612170130511.zip
  //    src/
  //      fileInSrc
  //      .build/
  //        src-lambda-handler-1612170130511

  //////////////////////////////
  // Verify root Lambda's build output
  //////////////////////////////
  const rootBuildPath = path.join(__dirname, config.buildDir);
  const rootBuildFiles = fs.readdirSync(rootBuildPath);
  // Verify folder exists
  let handlerHash;
  rootBuildFiles.forEach((file) => {
    if (file.match(/^lambda-handler-[\d]+$/)) {
      handlerHash = file;
    }
  });
  expect(handlerHash).toBeDefined();
  // Verify files copied over
  expect(
    fs.existsSync(path.join(rootBuildPath, handlerHash, "fileInRoot"))
  ).toBeTruthy();
  expect(
    fs.existsSync(
      path.join(rootBuildPath, handlerHash, "dirInRoot", "fileInDir")
    )
  ).toBeTruthy();
  expect(
    fs.existsSync(
      path.join(rootBuildPath, handlerHash, "dirInRoot", "sub", "fileInDirSub")
    )
  ).toBeTruthy();
  expect(
    fs.existsSync(path.join(rootBuildPath, handlerHash, "src", "fileInSrc"))
  ).toBeTruthy();

  //////////////////////////////
  // Verify src Lambda's build output
  //////////////////////////////
  const srcBuildPath = path.join(__dirname, config.buildDir, "src");
  const srcBuildFiles = fs.readdirSync(srcBuildPath);
  // Verify src Lambda's build output
  let srcHandlerHash;
  srcBuildFiles.forEach((file) => {
    if (file.match(/^src-lambda-handler-[\d]+$/)) {
      srcHandlerHash = file;
    }
  });
  expect(srcHandlerHash).toBeDefined();
  // Verify files copied over
  expect(
    fs.existsSync(path.join(srcBuildPath, srcHandlerHash, "fileInRoot"))
  ).toBeTruthy();
  expect(
    fs.existsSync(
      path.join(srcBuildPath, srcHandlerHash, "dirInRoot", "fileInDir")
    )
  ).toBeTruthy();
  expect(
    fs.existsSync(
      path.join(
        srcBuildPath,
        srcHandlerHash,
        "dirInRoot",
        "sub",
        "fileInDirSub"
      )
    )
  ).toBeTruthy();
  expect(
    fs.existsSync(path.join(srcBuildPath, srcHandlerHash, "fileInSrc"))
  ).toBeTruthy();
});
