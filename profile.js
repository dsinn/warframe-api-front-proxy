import { respond, fetchUpstream } from "./utils.js";

const VALID_PLATFORM = /^(?:pc|ps4|xb1|swi|mob)$/;
const VALID_PLAYER_ID_REGEX = /^[0-9a-f]{24}$/; // Keep in sync with validateAccountId() in browse.wf/profile.ts

export const extraAllowHeaders = ["Authorization"];
export const extraExposeHeaders = ["Retry-After"];

export function buildUrl(queryParams, privateProxyUrl) {
  const platform = queryParams.get("platform");
  const playerId = queryParams.get("playerId");
  if (!VALID_PLATFORM.test(platform) || !VALID_PLAYER_ID_REGEX.test(playerId)) {
    return null;
  }
  const upstreamUrl = `http://content${platform === "pc" ? "" : `-${platform}`}.warframe.com/dynamic/getProfileViewingData.php?playerId=${encodeURIComponent(playerId)}`;
  return `${privateProxyUrl}?url=${encodeURIComponent(upstreamUrl)}`;
}

export async function handle(upstreamUrl, request, env, origin) {
  if (!env.DATABASE_URL) {
    return respond("Unauthorized", 401, origin);
  }

  const authHeader = request.headers.get("Authorization");
  const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!jwt) {
    return respond("Unauthorized", 401, origin);
  }

  // Verify JWT via database auth endpoint
  const userRes = await fetch(`${env.DATABASE_URL}/auth/v1/user`, {
    headers: {
      "Authorization": `Bearer ${jwt}`,
      "apikey": env.DATABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!userRes.ok) {
    return respond("Unauthorized", 401, origin);
  }

  let user;
  try {
    user = await userRes.json();
  } catch {
    return respond("Unauthorized", 401, origin);
  }
  const userId = user?.id;
  if (!userId) {
    return respond("Unauthorized", 401, origin);
  }

  // Atomic rate limit check + counter increment
  const rpcRes = await fetch(`${env.DATABASE_URL}/rest/v1/rpc/try_profile_request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": env.DATABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.DATABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ p_user_id: userId }),
  });
  if (!rpcRes.ok) {
    return respond("Internal Server Error", 500, origin);
  }

  let rpcResult;
  try {
    rpcResult = await rpcRes.json(); // { allowed: boolean, next_fetch_available_at: ISO 8601 string }
  } catch {
    return respond("Internal Server Error", 500, origin);
  }
  if (!rpcResult.allowed) {
    const retryAfter = new Date(rpcResult.next_fetch_available_at).toUTCString();
    const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "Retry-After", "Retry-After": retryAfter };
    return new Response("Too Many Requests", { status: 429, headers });
  }

  const upstreamResponse = await fetchUpstream(upstreamUrl, env);
  if (!upstreamResponse) {
    return respond("Bad Gateway", 502, origin);
  }

  // Wrap the upstream body so the client gets the rate limit timestamp.
  // { "nextFetchAvailableAt": "<HTTP date>", "profile": <upstream JSON> }
  const profile = await upstreamResponse.json();
  const nextFetchAvailableAt = new Date(rpcResult.next_fetch_available_at).toUTCString();
  const headers = new Headers(upstreamResponse.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ nextFetchAvailableAt, profile }), { status: upstreamResponse.status, headers });
}
