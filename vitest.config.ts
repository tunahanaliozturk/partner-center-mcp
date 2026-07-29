import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // Floors set from the measured baseline (86.74 / 73.58 / 81.67 / 90.32),
      // rounded down so rounding jitter cannot cause a false failure. Raise
      // these when coverage improves; never lower them to make a build pass.
      thresholds: {
        statements: 86,
        branches: 73,
        functions: 81,
        lines: 90,
      },
    },
  },
});
