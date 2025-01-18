import { boolean, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const userTable = pgTable("user", {
  id: varchar({ length: 255 }).primaryKey(),
  name: varchar({ length: 255 }).notNull(),
  partner: boolean().notNull(),
});

export const mediumTable = pgTable("medium", {
  id: varchar({ length: 255 }).primaryKey(),
  name: varchar({ length: 255 }).notNull(),
});

export const messageTable = pgTable("message", {
  id: varchar({ length: 255 }).primaryKey(),
  senderID: varchar({ length: 255 }).references(() => userTable.id),
  mediumID: varchar({ length: 255 }).references(() => mediumTable.id),
  body: varchar({ length: 255 }).notNull(),
  timestamp: timestamp().notNull(),
});
