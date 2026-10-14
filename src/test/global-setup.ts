import { execSync } from "child_process";

// Brings the isolated test database up to the current schema before any test runs.
// Hard-guarded so it can never push to (or wipe) the dev or production database.
export default function setup() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/\/rebx_test(\?|$)/.test(url)) {
    throw new Error(`Refusing to run tests: DATABASE_URL must point at rebx_test, got ${url.replace(/:[^:@]*@/, ":***@")}`);
  }
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
