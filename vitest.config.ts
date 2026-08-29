import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Test files share one real sqlite DB (no isolated test DB is configured yet);
    // running files in parallel races blanket deleteMany() calls against other
    // files' fixtures. Run test files serially until per-file DB isolation exists.
    fileParallelism: false,
  },
});
