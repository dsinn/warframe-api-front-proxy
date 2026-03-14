export function buildPreflightResponse(route, origin) {
  const allowHeaders = ["X-Warframe-API-Front-Proxy-Token", ...(route.extraAllowHeaders ?? [])];
  const exposeHeaders = route.extraExposeHeaders ?? [];
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET",
    "Access-Control-Allow-Headers": allowHeaders.join(", "),
    "Access-Control-Max-Age": "86400",
  };
  if (exposeHeaders.length) {
    headers["Access-Control-Expose-Headers"] = exposeHeaders.join(", ");
  }
  return new Response(null, { status: 204, headers });
}

export function respond(body, status, origin) {
  const headers = { "Access-Control-Allow-Origin": origin ?? "*" };
  return new Response(body, { status, headers });
}

export function corsResponse(upstreamResponse, origin) {
  const headers = new Headers(upstreamResponse.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Content-Type", "application/json");
  return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers });
}

export async function fetchUpstream(upstreamUrl, env) {
  try {
    return await fetch(upstreamUrl, {
      // The private proxy compares X-Private-Proxy-Secret against its configured
      // PRIVATE_PROXY_SECRET (both default to ""), rejecting mismatches with 403.
      headers: { "X-Private-Proxy-Secret": env.PRIVATE_PROXY_SECRET || "" },
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 60, "400-599": 0 } },
    });
  } catch {
    return null;
  }
}
