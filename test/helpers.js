import { fetchMock } from "cloudflare:test";

export const VALID_ORIGIN = "https://allowed-host.test";
export const VALID_TOKEN = "test-token";
export const PRIVATE_PROXY_BASE = "https://private-proxy.test";
export const PRIVATE_PROXY_PATH = "/proxy.php";
export const DATABASE_BASE = "https://db.supabase.test";
export const DATABASE_SERVICE_ROLE_KEY = "test-service-role-key";

export const VALID_PLAYER_ID = "55540360384632532d7b23c6";

export const MOCK_WORLD_STATE = { timestamp: 1234567890, alerts: [] };
export const MOCK_PROFILE = { accountName: "TestPlayer", guildName: "" };

export function makeHeaders(origin = VALID_ORIGIN, token = VALID_TOKEN) {
  return { Origin: origin, "X-Warframe-API-Front-Proxy-Token": token };
}

export function interceptPrivateProxy(upstreamUrl, status, body) {
  fetchMock
    .get(PRIVATE_PROXY_BASE)
    .intercept({ path: PRIVATE_PROXY_PATH, query: { url: upstreamUrl } })
    .reply(status, typeof body === "string" ? body : JSON.stringify(body));
}
