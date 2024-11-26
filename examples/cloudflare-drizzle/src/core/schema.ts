import { sqliteTable, text } from "drizzle-orm/sqlite-core";

const ULID_SIZE = 24;
export const PREFIX_SIZE = 4;

export const brandedID = (name: string) => text(name, { length: ULID_SIZE + PREFIX_SIZE });

export const id = {
  get id() {
    return brandedID("id").primaryKey().notNull();
  },
};

export const timestamps = {
  get createTime() {
    return text("create_time").notNull().$default(() => new Date().toISOString());
  },
  get updateTime() {
    return text("update_time").notNull().$default(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString());
  },
};

export const accountsTable = sqliteTable("accounts", {
  ...id,
  ...timestamps,
  email: text("email").notNull(),
});

