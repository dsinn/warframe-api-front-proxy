import { describe, it, expect } from "vitest";
import { buildPreflightResponse } from "../utils.js";

const ORIGIN = "https://example.test";

describe("buildPreflightResponse", () => {
  it("always includes X-Warframe-API-Front-Proxy-Token in Allow-Headers", () => {
    const response = buildPreflightResponse({}, ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-Warframe-API-Front-Proxy-Token");
  });

  it("includes extraAllowHeaders when provided", () => {
    const response = buildPreflightResponse({ extraAllowHeaders: ["Authorization", "X-Custom"] }, ORIGIN);
    const header = response.headers.get("Access-Control-Allow-Headers");
    expect(header).toContain("Authorization");
    expect(header).toContain("X-Custom");
  });

  it("omits Expose-Headers when extraExposeHeaders is absent", () => {
    const response = buildPreflightResponse({}, ORIGIN);
    expect(response.headers.get("Access-Control-Expose-Headers")).toBeNull();
  });

  it("omits Expose-Headers when extraExposeHeaders is empty", () => {
    const response = buildPreflightResponse({ extraExposeHeaders: [] }, ORIGIN);
    expect(response.headers.get("Access-Control-Expose-Headers")).toBeNull();
  });

  it("includes extraExposeHeaders when provided", () => {
    const response = buildPreflightResponse({ extraExposeHeaders: ["Retry-After", "X-Custom"] }, ORIGIN);
    const header = response.headers.get("Access-Control-Expose-Headers");
    expect(header).toContain("Retry-After");
    expect(header).toContain("X-Custom");
  });

  it("returns 204 with correct origin and methods", () => {
    const response = buildPreflightResponse({}, ORIGIN);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
  });
});
