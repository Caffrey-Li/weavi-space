import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  outputDir: process.env.SMOKE_RESULTS || "test-results",
  use: { baseURL: "http://127.0.0.1:3112", ...devices["Desktop Chrome"], ...(process.env.SMOKE_USE_CHROME === "1" ? { channel: "chrome" } : {}) },
  reporter: "list",
});
