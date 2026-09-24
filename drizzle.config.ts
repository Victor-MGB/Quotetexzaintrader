import { defineConfig } from "drizzle-kit";
import { env } from "./src/core/config.js";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: env.DATABASE_URL,
    ssl: env.DB_SSL === "true",
  },
  verbose: true,
  strict: true,
});