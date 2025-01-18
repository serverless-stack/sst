import { defineConfig } from "drizzle-kit";
import { Resource } from "sst";

export default defineConfig({
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: `postgres://${Resource.Database.username}:${Resource.Database.password}@${Resource.Database.host}:${Resource.Database.port}/${Resource.Database.database}_cvr`,
  },
});
