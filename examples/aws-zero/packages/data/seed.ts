import { drizzle } from "drizzle-orm/node-postgres";
import { mediumTable, userTable } from "./schema";
import { sql } from "drizzle-orm";
import { Resource } from "sst";

const db = drizzle(
  `postgres://${Resource.Database.username}:${Resource.Database.password}@${Resource.Database.host}:${Resource.Database.port}/${Resource.Database.database}`
);

async function main() {
  await db.execute(sql`create database zero_cvr;`);
  await db.execute(sql`create database zero_change;`);

  const users: (typeof userTable.$inferInsert)[] = [
    { id: "ycD76wW4R2", name: "Aaron", partner: true },
    { id: "IoQSaxeVO5", name: "Matt", partner: true },
    { id: "WndZWmGkO4", name: "Cesar", partner: true },
    { id: "ENzoNm7g4E", name: "Erik", partner: true },
    { id: "dLKecN3ntd", name: "Greg", partner: true },
    { id: "enVvyDlBul", name: "Darick", partner: true },
    { id: "9ogaDuDNFx", name: "Alex", partner: true },
    { id: "6z7dkeVLNm", name: "Dax", partner: false },
    { id: "7VoEoJWEwn", name: "Nate", partner: false },
  ];
  users.forEach(async (user) => {
    await db.insert(userTable).values(user);
    console.log(`Inserted ${user.name} into user table`);
  });

  const mediums = [
    { id: "G14bSFuNDq", name: "Discord" },
    { id: "b7rqt_8w_H", name: "Twitter DM" },
    { id: "0HzSMcee_H", name: "Tweet reply to unrelated thread" },
    { id: "ttx7NCmyac", name: "SMS" },
  ];
  mediums.forEach(async (medium) => {
    await db.insert(mediumTable).values(medium);
    console.log(`Inserted ${medium.name} into medium table`);
  });
}
main();
