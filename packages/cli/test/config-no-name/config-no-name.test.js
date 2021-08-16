const {
  runBuildCommand,
  clearBuildOutput,
  defaultConfig: config,
} = require("../helpers");

beforeEach(async () => {
  await clearBuildOutput(__dirname, config.buildDir);
});

afterAll(async () => {
  await clearBuildOutput(__dirname, config.buildDir);
});

/**
 * Test that the synth command ran successfully
 */
test("config-no-name", async () => {
  const result = await runBuildCommand(__dirname, undefined, config);

  expect(result).toMatch(/Give your Serverless Stack app a name/);
});
