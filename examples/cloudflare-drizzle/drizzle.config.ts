import { defineConfig } from "drizzle-kit";
import { Resource } from "sst";

export default defineConfig({
  dialect: "turso",
  schema: "./src/core/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: Resource.TursoUrl.value,
    authToken: Resource.TursoAuthToken.value,
  }
});
