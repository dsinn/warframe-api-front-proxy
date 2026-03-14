import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import worker from "../index.js";
import {
  VALID_TOKEN,
  PRIVATE_PROXY_BASE,
  PRIVATE_PROXY_PATH,
  DATABASE_BASE,
  DATABASE_SERVICE_ROLE_KEY,
  VALID_PLAYER_ID,
  MOCK_PROFILE,
  makeHeaders,
  interceptPrivateProxy,
} from "./helpers.js";

const VALID_USER_ID = "00000000-0000-0000-0000-000000000001";
const FUTURE_TIMESTAMP = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();

function makeProfileHeaders(extraHeaders = {}) {
  return { ...makeHeaders(), Authorization: "Bearer test-jwt", ...extraHeaders };
}

function interceptAuth(status, body) {
  fetchMock
    .get(DATABASE_BASE)
    .intercept({
      path: "/auth/v1/user",
      headers: { Authorization: "Bearer test-jwt", apikey: DATABASE_SERVICE_ROLE_KEY },
    })
    .reply(status, typeof body === "string" ? body : JSON.stringify(body));
}

function interceptRpcAllowed(nextFetchAvailableAt) {
  fetchMock
    .get(DATABASE_BASE)
    .intercept({ path: "/rest/v1/rpc/try_profile_request", method: "POST" })
    .reply(200, JSON.stringify({ allowed: true, next_fetch_available_at: nextFetchAvailableAt }));
}

function interceptRpcDenied(nextFetchAvailableAt) {
  fetchMock
    .get(DATABASE_BASE)
    .intercept({ path: "/rest/v1/rpc/try_profile_request", method: "POST" })
    .reply(200, JSON.stringify({ allowed: false, next_fetch_available_at: nextFetchAvailableAt }));
}

function interceptPrivateProxyForProfile() {
  interceptPrivateProxy(
    `http://content.warframe.com/dynamic/getProfileViewingData.php?playerId=${VALID_PLAYER_ID}`,
    200,
    MOCK_PROFILE,
  );
}

describe("GET /profile", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.assertNoPendingInterceptors();
    fetchMock.deactivate();
  });

  describe("environment variable validation", () => {
    const BASE_ENV = {
      ALLOWED_HOST: "allowed-host.test",
      WARFRAME_API_FRONT_PROXY_TOKEN: VALID_TOKEN,
      PRIVATE_PROXY_URL: `${PRIVATE_PROXY_BASE}${PRIVATE_PROXY_PATH}`,
    };

    it("returns 401 when DATABASE_URL is not configured", async () => {
      const req = new Request(`https://worker.example.com/profile?platform=pc&playerId=${VALID_PLAYER_ID}`, { headers: makeHeaders() });
      const response = await worker.fetch(req, BASE_ENV, {});
      expect(response.status).toBe(401);
    });
  });

  describe("authorization", () => {
    it("returns 401 when no Authorization header is provided", async () => {
      const response = await SELF.fetch(
        `https://worker.example.com/profile?platform=pc&playerId=${VALID_PLAYER_ID}`,
        { headers: makeHeaders() },
      );
      expect(response.status).toBe(401);
    });

    it("returns 401 when the JWT is rejected by the database auth endpoint", async () => {
      interceptAuth(401, "Unauthorized");
      const response = await SELF.fetch(
        `https://worker.example.com/profile?platform=pc&playerId=${VALID_PLAYER_ID}`,
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(401);
    });

    it("returns 401 when the auth endpoint returns non-JSON", async () => {
      fetchMock
        .get(DATABASE_BASE)
        .intercept({ path: "/auth/v1/user" })
        .reply(200, "<html>error</html>", { headers: { "Content-Type": "text/html" } });
      const response = await SELF.fetch(
        `https://worker.example.com/profile?platform=pc&playerId=${VALID_PLAYER_ID}`,
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(401);
    });
  });

  describe("rate limiting", () => {
    it("returns 429 with Retry-After header when rate-limited", async () => {
      interceptAuth(200, { id: VALID_USER_ID });
      interceptRpcDenied(FUTURE_TIMESTAMP);
      const response = await SELF.fetch(
        `https://worker.example.com/profile?platform=pc&playerId=${VALID_PLAYER_ID}`,
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(429);
      const retryAfter = new Date(response.headers.get("Retry-After")).getTime();
      expect(retryAfter).toBeGreaterThan(Date.now());
      expect(retryAfter).toBeLessThanOrEqual(new Date(FUTURE_TIMESTAMP).getTime());
      expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
    });

    it("returns 500 when the RPC endpoint returns non-JSON", async () => {
      interceptAuth(200, { id: VALID_USER_ID });
      fetchMock
        .get(DATABASE_BASE)
        .intercept({ path: "/rest/v1/rpc/try_profile_request", method: "POST" })
        .reply(200, "<html>error</html>", { headers: { "Content-Type": "text/html" } });
      const response = await SELF.fetch(
        `https://worker.example.com/profile?platform=pc&playerId=${VALID_PLAYER_ID}`,
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(500);
    });

    it("returns 500 when the RPC call fails", async () => {
      interceptAuth(200, { id: VALID_USER_ID });
      fetchMock
        .get(DATABASE_BASE)
        .intercept({ path: "/rest/v1/rpc/try_profile_request", method: "POST" })
        .reply(500, "Internal Server Error");
      const response = await SELF.fetch(
        `https://worker.example.com/profile?platform=pc&playerId=${VALID_PLAYER_ID}`,
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(500);
    });
  });

  describe("parameter validation", () => {
    it("returns 422 for an invalid platform", async () => {
      const response = await SELF.fetch(
        `https://worker.example.com/profile?platform=invalid&playerId=${VALID_PLAYER_ID}`,
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(422);
    });

    it("returns 422 for an invalid playerId (non-hex characters)", async () => {
      const response = await SELF.fetch(
        "https://worker.example.com/profile?platform=pc&playerId=not-hex!",
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(422);
    });

    it("returns 422 for a playerId that is not 24 characters", async () => {
      const response = await SELF.fetch(
        "https://worker.example.com/profile?platform=pc&playerId=abc123",
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(422);
    });

    it("returns 422 when platform is missing", async () => {
      const response = await SELF.fetch(
        `https://worker.example.com/profile?playerId=${VALID_PLAYER_ID}`,
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(422);
    });

    it("returns 422 when playerId is missing", async () => {
      const response = await SELF.fetch(
        "https://worker.example.com/profile?platform=pc",
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(422);
    });
  });

  describe("successful requests", () => {
    it("forwards a valid PC profile request and returns wrapped response", async () => {
      interceptAuth(200, { id: VALID_USER_ID });
      interceptRpcAllowed(FUTURE_TIMESTAMP);
      interceptPrivateProxyForProfile();

      const response = await SELF.fetch(
        `https://worker.example.com/profile?platform=pc&playerId=${VALID_PLAYER_ID}`,
        { headers: makeProfileHeaders() },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      // HTTP date format has second precision; compare at that granularity
      expect(new Date(body.nextFetchAvailableAt).getTime()).toBe(Math.floor(new Date(FUTURE_TIMESTAMP).getTime() / 1000) * 1000);
      expect(body.profile).toEqual(MOCK_PROFILE);
    });

    it("forwards a valid PS4 profile request with platform suffix", async () => {
      interceptAuth(200, { id: VALID_USER_ID });
      interceptRpcAllowed(FUTURE_TIMESTAMP);
      interceptPrivateProxy(
        `http://content-ps4.warframe.com/dynamic/getProfileViewingData.php?playerId=${VALID_PLAYER_ID}`,
        200,
        MOCK_PROFILE,
      );

      const response = await SELF.fetch(
        `https://worker.example.com/profile?platform=ps4&playerId=${VALID_PLAYER_ID}`,
        { headers: makeProfileHeaders() },
      );
      expect(response.status).toBe(200);
    });

    it("supports all valid platforms", async () => {
      for (const platform of ["pc", "ps4", "xb1", "swi", "mob"]) {
        interceptAuth(200, { id: VALID_USER_ID });
        interceptRpcAllowed(FUTURE_TIMESTAMP);
        const platformSuffix = platform === "pc" ? "" : `-${platform}`;
        interceptPrivateProxy(
          `http://content${platformSuffix}.warframe.com/dynamic/getProfileViewingData.php?playerId=${VALID_PLAYER_ID}`,
          200,
          MOCK_PROFILE,
        );

        const response = await SELF.fetch(
          `https://worker.example.com/profile?platform=${platform}&playerId=${VALID_PLAYER_ID}`,
          { headers: makeProfileHeaders() },
        );
        expect(response.status).toBe(200);
      }
    });
  });
});
