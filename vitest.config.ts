import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // Floors set from the measured baseline (88.62 / 75.72 / 85.41 / 91.59),
      // rounded down so rounding jitter cannot cause a false failure. Raise
      // these when coverage improves; never lower them to make a build pass.
      thresholds: {
        statements: 88,
        branches: 75,
        functions: 85,
        lines: 91,
      },
    },
  },
});
