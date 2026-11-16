import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads optional local `.env.local` and `.env` files for the standalone worker
 * without importing Next.js and without overriding variables already present in `process.env`.
 */
export function loadOptionalRepoEnvFiles(): void {
  const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof loadEnvFile !== "function") return;

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(currentDir, "../../../.env.local"),
    path.resolve(currentDir, "../../../.env"),
  ];

  for (const filePath of Array.from(new Set(candidates))) {
    if (fs.existsSync(filePath)) {
      try {
        loadEnvFile(filePath);
      } catch {
        // Ignore malformed optional env file errors here; callers report missing/invalid config explicitly.
      }
    }
  }
}

