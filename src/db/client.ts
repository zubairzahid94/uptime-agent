import "dotenv/config";
import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });

export const prisma = new PrismaClient({ adapter });
export type { Monitor, Check, Action } from "../../generated/prisma/client.js";
