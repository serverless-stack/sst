import { type Context, Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql/web";
import { createClient } from "@libsql/client/web";
import * as schema from "./core/schema.ts";
import { createId } from "./core/lib/id.ts";
import { Resource as SstResource } from "sst";
import { eq } from "drizzle-orm";
import { mustTakeFirst } from "./core/lib/array.ts";

const api = new Hono();

function Resource(c: Context) {
  return SstResource;
}

function db(c: Context) {
  const client = createClient({ url: Resource(c).TursoUrl.value, authToken: Resource(c).TursoAuthToken.value });
  return drizzle({ client, schema });
}

api.get("/ping", async c => c.text("pong"));

api.post("/accounts", async c => {
  const id = createId("account");
  await db(c)
    .insert(schema.accountsTable)
    .values({
      id,
      email: `${id}@gmail.com`
    });

  return c.json({ id });
});

api.get("/accounts/:id", async c => {
  const id = c.req.param("id");

  const account = await db(c).select().from(schema.accountsTable).where(eq(schema.accountsTable.id, id)).then(mustTakeFirst);

  return c.json(account);
});

export default api;
