import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import worker from "../index.js";
import {
  VALID_ORIGIN,
  VALID_TOKEN,
  PRIVATE_PROXY_BASE,
  PRIVATE_PROXY_PATH,
  DATABASE_BASE,
  DATABASE_SERVICE_ROLE_KEY,
  VALID_PLAYER_ID,
  MOCK_WORLD_STATE,
  makeHeaders,
  interceptPrivateProxy,
} from "./helpers.js";

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
    it("responds 204 to OPTIONS /worldState from an allowed origin", async () => {
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
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-Warframe-API-Front-Proxy-Token");
      expect(response.headers.get("Access-Control-Allow-Headers")).not.toContain("Authorization");
      expect(response.headers.get("Access-Control-Expose-Headers")).toBeNull();
    });

    it("responds 204 to OPTIONS /profile with extra CORS headers", async () => {
      const response = await SELF.fetch(`https://worker.example.com/profile?platform=pc&playerId=${VALID_PLAYER_ID}`, {
        method: "OPTIONS",
        headers: {
          Origin: VALID_ORIGIN,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "X-Warframe-API-Front-Proxy-Token, Authorization",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-Warframe-API-Front-Proxy-Token");
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
      expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
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

  describe("environment variable validation", () => {
    const BASE_ENV = {
      ALLOWED_HOST: "allowed-host.test",
      WARFRAME_API_FRONT_PROXY_TOKEN: VALID_TOKEN,
      PRIVATE_PROXY_URL: `${PRIVATE_PROXY_BASE}${PRIVATE_PROXY_PATH}`,
    };

    it("returns 500 when DATABASE_URL is set without DATABASE_SERVICE_ROLE_KEY", async () => {
      const req = new Request("https://worker.example.com/worldState", { headers: makeHeaders() });
      const response = await worker.fetch(req, { ...BASE_ENV, DATABASE_URL: DATABASE_BASE }, {});
      expect(response.status).toBe(500);
    });

    it("returns 500 when DATABASE_SERVICE_ROLE_KEY is set without DATABASE_URL", async () => {
      const req = new Request("https://worker.example.com/worldState", { headers: makeHeaders() });
      const response = await worker.fetch(req, { ...BASE_ENV, DATABASE_SERVICE_ROLE_KEY }, {});
      expect(response.status).toBe(500);
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
