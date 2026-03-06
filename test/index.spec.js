import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";

const VALID_ORIGIN = "https://allowed-host.test";
const VALID_TOKEN = "test-token";
const PRIVATE_PROXY_BASE = "https://private-proxy.test";
const PRIVATE_PROXY_PATH = "/proxy.php";

const MOCK_WORLD_STATE = { timestamp: 1234567890, alerts: [] };
const MOCK_PROFILE = { accountName: "TestPlayer", guildName: "" };

function makeHeaders(origin = VALID_ORIGIN, token = VALID_TOKEN) {
  return { Origin: origin, "X-Warframe-API-Front-Proxy-Token": token };
}

function interceptPrivateProxy(upstreamUrl, status, body) {
  fetchMock
    .get(PRIVATE_PROXY_BASE)
    .intercept({ path: PRIVATE_PROXY_PATH, query: { url: upstreamUrl } })
    .reply(status, typeof body === "string" ? body : JSON.stringify(body));
}

describe("warframe-api-front-proxy", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.assertNoPendingInterceptors();
    fetchMock.deactivate();
  });

  describe("CORS preflight", () => {
    it("responds 204 to OPTIONS from an allowed origin", async () => {
      const response = await SELF.fetch("https://worker.example.com/worldState", {
        method: "OPTIONS",
        headers: {
          Origin: VALID_ORIGIN,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "X-Warframe-API-Front-Proxy-Token",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(VALID_ORIGIN);
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET");
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe("X-Warframe-API-Front-Proxy-Token");
    });

    it("rejects OPTIONS from a disallowed origin", async () => {
      const response = await SELF.fetch("https://worker.example.com/worldState", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.com" },
      });
      expect(response.status).toBe(403);
    });
  });

  describe("origin validation", () => {
    it("rejects requests with no Origin header", async () => {
      const response = await SELF.fetch("https://worker.example.com/worldState");
      expect(response.status).toBe(403);
    });

    it("rejects requests from disallowed origins", async () => {
      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: makeHeaders("https://evil.com"),
      });
      expect(response.status).toBe(403);
    });

    it("allows requests from the configured host", async () => {
      interceptPrivateProxy("https://api.warframe.com/cdn/worldState.php", 200, MOCK_WORLD_STATE);

      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: makeHeaders("https://allowed-host.test"),
      });
      expect(response.status).toBe(200);
    });

    it("allows requests from localhost with any port", async () => {
      interceptPrivateProxy("https://api.warframe.com/cdn/worldState.php", 200, MOCK_WORLD_STATE);

      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: makeHeaders("http://localhost:60969"),
      });
      expect(response.status).toBe(200);
    });

    it("allows requests from 127.0.0.1 with any port", async () => {
      interceptPrivateProxy("https://api.warframe.com/cdn/worldState.php", 200, MOCK_WORLD_STATE);

      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: makeHeaders("http://127.0.0.1:8080"),
      });
      expect(response.status).toBe(200);
    });
  });

  describe("token validation", () => {
    it("rejects requests with no token", async () => {
      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: { Origin: VALID_ORIGIN },
      });
      expect(response.status).toBe(403);
    });

    it("rejects requests with the wrong token", async () => {
      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: makeHeaders(VALID_ORIGIN, "wrong-token"),
      });
      expect(response.status).toBe(403);
    });
  });

  describe("routing", () => {
    it("returns 404 for unknown routes", async () => {
      const response = await SELF.fetch("https://worker.example.com/unknown", {
        headers: makeHeaders(),
      });
      expect(response.status).toBe(404);
    });

    it("returns 404 for root path", async () => {
      const response = await SELF.fetch("https://worker.example.com/", {
        headers: makeHeaders(),
      });
      expect(response.status).toBe(404);
    });
  });

  describe("GET /worldState", () => {
    it("forwards the request to the private proxy and returns JSON", async () => {
      interceptPrivateProxy("https://api.warframe.com/cdn/worldState.php", 200, MOCK_WORLD_STATE);

      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: makeHeaders(),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("application/json");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(VALID_ORIGIN);
      expect(await response.json()).toEqual(MOCK_WORLD_STATE);
    });

    it("forwards non-200 upstream status codes", async () => {
      interceptPrivateProxy("https://api.warframe.com/cdn/worldState.php", 502, "Bad Gateway");

      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: makeHeaders(),
      });

      expect(response.status).toBe(502);
    });

    it("returns 502 with CORS header when private proxy is unreachable", async () => {
      fetchMock
        .get(PRIVATE_PROXY_BASE)
        .intercept({ path: PRIVATE_PROXY_PATH, query: { url: "https://api.warframe.com/cdn/worldState.php" } })
        .replyWithError("Connection refused");

      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: makeHeaders(),
      });

      expect(response.status).toBe(502);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(VALID_ORIGIN);
    });
  });

  describe("GET /profile", () => {
    it("forwards a valid PC profile request", async () => {
      interceptPrivateProxy(
        "http://content.warframe.com/dynamic/getProfileViewingData.php?playerId=abc123def456",
        200,
        MOCK_PROFILE,
      );

      const response = await SELF.fetch(
        "https://worker.example.com/profile?platform=pc&playerId=abc123def456",
        { headers: makeHeaders() },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(MOCK_PROFILE);
    });

    it("forwards a valid PS4 profile request with platform suffix", async () => {
      interceptPrivateProxy(
        "http://content-ps4.warframe.com/dynamic/getProfileViewingData.php?playerId=deadbeef",
        200,
        MOCK_PROFILE,
      );

      const response = await SELF.fetch(
        "https://worker.example.com/profile?platform=ps4&playerId=deadbeef",
        { headers: makeHeaders() },
      );

      expect(response.status).toBe(200);
    });

    it("returns 422 for an invalid platform", async () => {
      const response = await SELF.fetch(
        "https://worker.example.com/profile?platform=invalid&playerId=abc123",
        { headers: makeHeaders() },
      );
      expect(response.status).toBe(422);
    });

    it("returns 422 for an invalid playerId (non-hex characters)", async () => {
      const response = await SELF.fetch(
        "https://worker.example.com/profile?platform=pc&playerId=not-hex!",
        { headers: makeHeaders() },
      );
      expect(response.status).toBe(422);
    });

    it("returns 422 when platform is missing", async () => {
      const response = await SELF.fetch(
        "https://worker.example.com/profile?playerId=abc123",
        { headers: makeHeaders() },
      );
      expect(response.status).toBe(422);
    });

    it("returns 422 when playerId is missing", async () => {
      const response = await SELF.fetch(
        "https://worker.example.com/profile?platform=pc",
        { headers: makeHeaders() },
      );
      expect(response.status).toBe(422);
    });

    it("supports all valid platforms", async () => {
      for (const platform of ["pc", "ps4", "xb1", "swi", "mob"]) {
        const platformSuffix = platform === "pc" ? "" : `-${platform}`;
        interceptPrivateProxy(
          `http://content${platformSuffix}.warframe.com/dynamic/getProfileViewingData.php?playerId=abc123`,
          200,
          MOCK_PROFILE,
        );

        const response = await SELF.fetch(
          `https://worker.example.com/profile?platform=${platform}&playerId=abc123`,
          { headers: makeHeaders() },
        );
        expect(response.status).toBe(200);
      }
    });
  });

  describe("private proxy authentication", () => {
    it("sends X-Private-Proxy-Secret to the private proxy", async () => {
      // The mock only matches if X-Private-Proxy-Secret is exactly the configured secret.
      // If the worker doesn't send the header, no interceptor matches and the test fails.
      fetchMock
        .get(PRIVATE_PROXY_BASE)
        .intercept({
          path: PRIVATE_PROXY_PATH,
          query: { url: "https://api.warframe.com/cdn/worldState.php" },
          headers: { "x-private-proxy-secret": "test-private-proxy-secret" },
        })
        .reply(200, JSON.stringify(MOCK_WORLD_STATE));

      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: makeHeaders(),
      });
      expect(response.status).toBe(200);
    });
  });

  describe("CORS headers", () => {
    it("includes Access-Control-Allow-Origin on error responses", async () => {
      const response = await SELF.fetch("https://worker.example.com/worldState", {
        headers: makeHeaders(VALID_ORIGIN, "wrong-token"),
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
    });
  });
});
