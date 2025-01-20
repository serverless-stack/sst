import { lexicographicSortSchema, printSchema } from "graphql";
import path from "path";
import { schema } from "./schema";

async function extract() {
  const schemaAsString = printSchema(lexicographicSortSchema(schema));

  await Bun.write("./graphql/schema.graphql", schemaAsString);

  const proc = Bun.spawn(
    [
      "bun",
      "x",
      "@genql/cli",
      "--output",
      "./genql",
      "--schema",
      "./schema.graphql",
      "--esm",
    ],
    {
      cwd: "./graphql",
    }
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw Error(`Genegration faild with code ${exitCode}`);
  }
}

extract()
  .then(() => {
    console.log("Pothos schema extracted successfully.");
  })
  .catch((error) => {
    console.error("Failed to extract pothos schema the database:", error);
  });
