import pg from "pg";
import { Resource } from "sst";
const { Client } = pg;
const client = new Client({
  user: Resource.MyPostgres.username,
  password: Resource.MyPostgres.password,
  database: Resource.MyPostgres.database,
  host: Resource.MyPostgres.host,
  port: Resource.MyPostgres.port,
});
await client.connect();

export async function handler() {
  const res = await client.query("SELECT $1::text as message", [
    "Hello world!",
  ]);
  return {
    statusCode: 200,
    body: res.rows[0].message,
  };
}
