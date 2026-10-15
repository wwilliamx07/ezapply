import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.{ts,tsx}", "packages/sites/src/*/test/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
