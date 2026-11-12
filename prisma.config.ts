import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads `.env` implicitly, and the connection URL is no longer
// allowed in `schema.prisma` — the CLI gets it from here instead.
loadEnv({ path: ".env", quiet: true });

// Deliberately not `env("DATABASE_URL")`: that throws on *every* command, including
// `prisma generate`, which needs no database. Without a URL the datasource is simply
// omitted and the CLI reports a clear error for the commands that do need one.
const url = process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  ...(url ? { datasource: { url } } : {}),
});
