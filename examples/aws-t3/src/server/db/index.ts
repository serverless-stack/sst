import { Pool } from "pg";
import { Resource } from "sst";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

const pool = new Pool({
  host: Resource.MyPostgres.host,
  port: Resource.MyPostgres.port,
  user: Resource.MyPostgres.username,
  password: Resource.MyPostgres.password,
  database: Resource.MyPostgres.database,
});

export const db = drizzle(pool, { schema });
