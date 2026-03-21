import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });
const schemaPath = resolve(process.cwd(), "db/schema.sql");
const seedPath = resolve(process.cwd(), "db/seed.sql");

const schemaSql = readFileSync(schemaPath, "utf8");
const seedSql = readFileSync(seedPath, "utf8");

await client.connect();
try {
  await client.query("begin");
  await client.query(schemaSql);
  await client.query(seedSql);
  await client.query("commit");
  console.log("DB schema + seed applied");
} catch (err) {
  await client.query("rollback");
  throw err;
} finally {
  await client.end();
}
