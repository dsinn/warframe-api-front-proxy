import { respond, corsResponse, fetchUpstream } from "./utils.js";

export function buildUrl(_queryParams, privateProxyUrl) {
  return `${privateProxyUrl}?url=${encodeURIComponent("https://api.warframe.com/cdn/worldState.php")}`;
}

export async function handle(upstreamUrl, _request, env, origin) {
  const upstreamResponse = await fetchUpstream(upstreamUrl, env);
  if (!upstreamResponse) {
    return respond("Bad Gateway", 502, origin);
  }
  return corsResponse(upstreamResponse, origin);
}
