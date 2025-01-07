import { Resource } from "sst";
import mysql from "mysql2/promise";

const connection = await mysql.createConnection({
  database: Resource.MyDatabase.database,
  host: Resource.MyDatabase.host,
  port: Resource.MyDatabase.port,
  user: Resource.MyDatabase.username,
  password: Resource.MyDatabase.password,
});

export async function handler() {
  const [rows] = await connection.query("SELECT ? as message", [
    "Hello world!",
  ]);
  return {
    statusCode: 200,
    body: rows[0].message,
  };
}
