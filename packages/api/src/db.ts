import postgres from "postgres";
import { config } from "./config.js";

export const sql = postgres(config.databaseUrl, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 15,
  onnotice: () => {},
});

export async function pingDb(): Promise<void> {
  await sql`SELECT 1`;
}
