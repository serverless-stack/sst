import postgres from "postgres";
import { Resource } from "sst";

const sql = postgres({
  username: Resource.MyPostgres.username,
  password: Resource.MyPostgres.password,
  database: Resource.MyPostgres.database,
  host: Resource.MyPostgres.host,
  port: Resource.MyPostgres.port,
});

export async function handler() {
  const result = await sql`SELECT NOW()`;

  return {
    statusCode: 200,
    body: `Querying ${Resource.MyPostgres.host}\n\n` + result.rows[0].now,
  };
}
