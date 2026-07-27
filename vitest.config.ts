import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // No thresholds yet: measure first, then set the floor at the observed
      // number so it can only ratchet upward.
    },
  },
});
