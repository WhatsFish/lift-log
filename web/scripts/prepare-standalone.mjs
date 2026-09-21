import { cp } from "node:fs/promises";
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
