// The API hosts a scenario can target, keyed to the prefix each API's own docs
// omit from their documented routes. Partner Center docs state routes without
// any host; Graph docs state routes without the /v1.0 version segment (but do
// include the host); the referrals docs include both host and version. Each
// base below is exactly what its docs leave out, so a scenario's relative
// `path` lines up with `requestSyntax.uri` for free.
export const API_BASES = {
  "partner-center": "https://api.partnercenter.microsoft.com",
  graph: "https://graph.microsoft.com/v1.0",
  "pricing-and-referrals": "https://api.partner.microsoft.com",
  // Legacy delegated-admin statistics, documented against their own traffic
  // manager host rather than the Partner Center one. Two read-only endpoints;
  // the modern equivalent of what they report lives in Microsoft Graph.
  "customer-service-admin": "https://traf-pcsvcadmin-prod.trafficmanager.net",
} as const;

export type ApiId = keyof typeof API_BASES;

// The base URL for a scenario's api field, defaulting to Partner Center when
// absent (the vast majority of scenarios target Partner Center and leave
// `api` unset).
export function baseUrlFor(api: ApiId | undefined): string {
  return API_BASES[api ?? "partner-center"];
}

// The pathname portion of that base, with any trailing slash removed, so a
// caller can reconstruct the full request path documented by the API's own
// docs (e.g. "/v1.0" for graph, "" for the others).
export function basePathFor(api: ApiId | undefined): string {
  const base = baseUrlFor(api);
  const pathname = new URL(base).pathname;
  return pathname === "/" ? "" : pathname.replace(/\/$/, "");
}
