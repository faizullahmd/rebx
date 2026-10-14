import { defineConfig } from "vitest/config";
import path from "path";

// Tests never touch the dev or production database: they always run against rebx_test.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "mysql://rebx:rebx_dev_password@localhost:3306/rebx_test";

// Forced for the main process (global setup) and every worker, even if the shell has a
// different DATABASE_URL exported, so a test run can never reach dev or production data.
process.env.DATABASE_URL = TEST_DATABASE_URL;
// Pinned so tests never depend on whatever sender the developer's .env defines.
process.env.RESEND_FROM_EMAIL = "REBX <onboarding@resend.dev>";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AUTH_SECRET: "test-secret",
      RESEND_API_KEY: "re_test_not_a_real_key",
      RESEND_FROM_EMAIL: "REBX <onboarding@resend.dev>",
    },
    globalSetup: ["src/test/global-setup.ts"],
    fileParallelism: false,
  },
});
