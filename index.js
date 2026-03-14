import { respond, buildPreflightResponse } from "./utils.js";
import * as worldState from "./worldState.js";
import * as profile from "./profile.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let allowedOrigin = null;

function isAllowedOrigin(origin, allowedHost) {
  if (!origin) return false;
  allowedOrigin ??= new RegExp(`^https?:\\/\\/(?:${escapeRegex(allowedHost)}|localhost|127\\.0\\.0\\.1)(?::\\d+)?$`);
  return allowedOrigin.test(origin);
}

const ROUTES = {
  "/worldState": worldState,
  "/profile": profile,
};

const ROUTES_PATTERN = new RegExp(`^(?:${Object.keys(ROUTES).map(escapeRegex).join("|")})$`);

export default {
  async fetch(request, env, _ctx) {
    const origin = request.headers.get("Origin");

    for (const key of ["ALLOWED_HOST", "WARFRAME_API_FRONT_PROXY_TOKEN", "PRIVATE_PROXY_URL"]) {
      if (!env[key]) {
        return respond(`${key} environment variable is not set`, 500, origin);
      }
    }

    if (!!env.DATABASE_URL !== !!env.DATABASE_SERVICE_ROLE_KEY) {
      return respond("DATABASE_URL and DATABASE_SERVICE_ROLE_KEY must both be set or both be unset", 500, origin);
    }

    if (!isAllowedOrigin(origin, env.ALLOWED_HOST)) {
      return respond("Forbidden", 403, origin);
    }

    const { pathname, searchParams: queryParams } = new URL(request.url);
    if (!ROUTES_PATTERN.test(pathname)) {
      return respond("Not Found", 404, origin);
    }

    const route = ROUTES[pathname];

    if (request.method === "OPTIONS") {
      return buildPreflightResponse(route, origin);
    }

    if (request.headers.get("X-Warframe-API-Front-Proxy-Token") !== env.WARFRAME_API_FRONT_PROXY_TOKEN) {
      return respond("Forbidden", 403, origin);
    }
    const upstreamUrl = route.buildUrl(queryParams, env.PRIVATE_PROXY_URL);
    if (!upstreamUrl) {
      return respond("Unprocessable Entity", 422, origin);
    }

    return route.handle(upstreamUrl, request, env, origin);
  },
};
