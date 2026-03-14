import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            ALLOWED_HOST: "allowed-host.test",
            WARFRAME_API_FRONT_PROXY_TOKEN: "test-token",
            PRIVATE_PROXY_URL: "https://private-proxy.test/proxy.php",
            PRIVATE_PROXY_SECRET: "test-private-proxy-secret",
            DATABASE_URL: "https://db.supabase.test",
            DATABASE_SERVICE_ROLE_KEY: "test-service-role-key",
          },
        },
      },
    },
  },
});
