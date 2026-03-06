const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let allowedOrigin = null;

function isAllowedOrigin(origin, allowedHost) {
  if (!origin) return false;
  allowedOrigin ??= new RegExp(`^https?:\\/\\/(?:${escapeRegex(allowedHost)}|localhost|127\\.0\\.0\\.1)(?::\\d+)?$`);
  return allowedOrigin.test(origin);
}

const VALID_PLATFORM = /^(?:pc|ps4|xb1|swi|mob)$/;
const VALID_PLAYER_ID = /^[0-9a-f]+$/;

const ROUTES = {
  "/worldState": (_queryParams, privateProxyUrl) =>
    `${privateProxyUrl}?url=${encodeURIComponent("https://api.warframe.com/cdn/worldState.php")}`,

  "/profile": (queryParams, privateProxyUrl) => {
    const platform = queryParams.get("platform");
    const playerId = queryParams.get("playerId");
    if (!VALID_PLATFORM.test(platform) || !VALID_PLAYER_ID.test(playerId)) {
      return null;
    }
    const upstreamUrl = `http://content${platform === "pc" ? "" : `-${platform}`}.warframe.com/dynamic/getProfileViewingData.php?playerId=${encodeURIComponent(playerId)}`;
    return `${privateProxyUrl}?url=${encodeURIComponent(upstreamUrl)}`;
  },
};

const ROUTES_PATTERN = new RegExp(`^(?:${Object.keys(ROUTES).map(escapeRegex).join("|")})$`);

function respond(body, status, origin) {
  const headers = { "Access-Control-Allow-Origin": origin ?? "*" };
  return new Response(body, { status, headers });
}

export default {
  async fetch(request, env, _ctx) {
    const origin = request.headers.get("Origin");

    for (const key of ["ALLOWED_HOST", "WARFRAME_API_FRONT_PROXY_TOKEN", "PRIVATE_PROXY_URL"]) {
      if (!env[key]) {
        return respond(`${key} environment variable is not set`, 500, origin);
      }
    }

    if (!isAllowedOrigin(origin, env.ALLOWED_HOST)) {
      return respond("Forbidden", 403, origin);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "X-Warframe-API-Front-Proxy-Token",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.headers.get("X-Warframe-API-Front-Proxy-Token") !== env.WARFRAME_API_FRONT_PROXY_TOKEN) {
      return respond("Forbidden", 403, origin);
    }

    const { pathname, searchParams: queryParams } = new URL(request.url);
    if (!ROUTES_PATTERN.test(pathname)) {
      return respond("Not Found", 404, origin);
    }

    const upstreamUrl = ROUTES[pathname](queryParams, env.PRIVATE_PROXY_URL);
    if (!upstreamUrl) {
      return respond("Unprocessable Entity", 422, origin);
    }

    let response;
    try {
      response = await fetch(upstreamUrl, {
        // The private proxy compares X-Private-Proxy-Secret against its configured
        // PRIVATE_PROXY_SECRET (both default to ""), rejecting mismatches with 403.
        headers: { "X-Private-Proxy-Secret": env.PRIVATE_PROXY_SECRET || "" },
        cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 60, "400-599": 0 } },
      });
    } catch {
      return respond("Bad Gateway", 502, origin);
    }
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Content-Type", "application/json");

    return new Response(response.body, { status: response.status, headers });
  },
};
