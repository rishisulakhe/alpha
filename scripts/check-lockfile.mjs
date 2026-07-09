import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const lockfile = resolve(root, "bun.lock");

if (!existsSync(lockfile)) {
  console.error("❌ bun.lock is missing. Run `bun install` to regenerate it.");
  process.exit(1);
}

const content = readFileSync(lockfile, "utf-8");
if (content.trim().length === 0) {
  console.error("❌ bun.lock is empty. Run `bun install` to regenerate it.");
  process.exit(1);
}

console.log("✅ bun.lock is present and valid");
