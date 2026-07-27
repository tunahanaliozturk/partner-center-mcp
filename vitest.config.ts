import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // Floors set from the measured baseline (80.32 / 65.10 / 73.60 / 84.83),
      // rounded down so rounding jitter cannot cause a false failure. Raise
      // these when coverage improves; never lower them to make a build pass.
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 73,
        lines: 84,
      },
    },
  },
});
