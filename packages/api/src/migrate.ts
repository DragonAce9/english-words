import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { sql } from "./db.js";

export async function migrate(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(config.migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const applied = await sql<{ id: string }[]>`
      SELECT id FROM schema_migrations WHERE id = ${file}
    `;
    if (applied.length > 0) continue;

    const body = await readFile(join(config.migrationsDir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (id) VALUES (${file})`;
    });
    console.info(`applied migration ${file}`);
  }
}
