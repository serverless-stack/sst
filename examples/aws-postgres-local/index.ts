import { Pool } from "pg";
import { Resource } from "sst";

const pool = new Pool({
  host: Resource.MyPostgres.host,
  port: Resource.MyPostgres.port,
  user: Resource.MyPostgres.username,
  password: Resource.MyPostgres.password,
  database: Resource.MyPostgres.database,
});

export async function handler() {
  const client = await pool.connect();
  const result = await client.query('SELECT NOW()');
  client.release();

  return {
    statusCode: 200,
    body: `Querying ${Resource.MyPostgres.host}\n\n`
      + result.rows[0].now,
  };
}
