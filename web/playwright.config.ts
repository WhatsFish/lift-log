import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3015/lift-log",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { "x-lift-user": "e2e", origin: "http://127.0.0.1:3015" },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3015/lift-log/api/health",
    reuseExistingServer: false,
    env: {
      PG_HOST: "127.0.0.1", PG_PORT: "55435", PG_USER: "lift_test", PG_DB: "lift_test",
      PG_PASSWORD: "ephemeral-test-only", PUBLIC_ORIGIN: "http://127.0.0.1:3015",
    },
  },
});
