import postgres from "postgres";
import { Resource } from "sst";

const sql = postgres({
  username: Resource.MyDatabase.username,
  password: Resource.MyDatabase.password,
  database: Resource.MyDatabase.database,
  host: Resource.MyDatabase.host,
  port: Resource.MyDatabase.port,
});

export async function handler() {
  const res = await sql`SELECT ${"Hello world!"}::text as message`;
  return {
    statusCode: 200,
    body: res.at(0)?.message,
  };
}
