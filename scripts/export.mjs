// Generate an OpenAPI 3.0 spec and a Postman v2.1 collection from the scenario pack.
// Writes to generated/. Run: npm run export
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const COMMERCIAL = "https://api.partnercenter.microsoft.com";
const root = new URL("../", import.meta.url);
const scenarios = JSON.parse(readFileSync(new URL("data/scenarios.json", root), "utf8")).scenarios;
const version = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;
mkdirSync(new URL("generated/", root), { recursive: true });

const pathOnly = (p) => p.split("?")[0];
const queryKeys = (p) => {
  const q = p.split("?")[1];
  if (!q) return [];
  return q.split("&").map((kv) => kv.split("=")[0]).filter(Boolean);
};
const pathParams = (p) => [...pathOnly(p).matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const topFields = (fields) => [...new Set((fields ?? []).filter((f) => !f.name.startsWith("(")).map((f) => f.name.split(".")[0].replace(/\[\]$/, "")))];

// ---- OpenAPI (partner-center host scenarios only) ----
const openapi = {
  openapi: "3.0.3",
  info: { title: "Partner Center REST (unofficial, generated)", version, description: "Generated from partner-center-mcp's verified scenario pack. Not affiliated with Microsoft." },
  servers: [{ url: COMMERCIAL }],
  security: [{ bearerAuth: [] }],
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
  paths: {},
};
for (const s of scenarios) {
  if (s.path.startsWith("http")) continue; // graph/partner hosts are in the Postman collection only
  const key = pathOnly(s.path);
  openapi.paths[key] ??= {};
  const params = [
    ...pathParams(s.path).map((n) => ({ name: n, in: "path", required: true, schema: { type: "string" } })),
    ...queryKeys(s.path).map((n) => ({ name: n, in: "query", required: false, schema: { type: "string" } })),
  ];
  const op = {
    operationId: s.id,
    summary: s.title,
    description: (s.gotchas ?? []).join("\n"),
    parameters: params,
    responses: { "200": { description: "Success" } },
    externalDocs: { url: s.docUrl },
  };
  if (s.requestFields?.length) {
    op.requestBody = {
      required: true,
      content: { "application/json": { schema: { type: "object", properties: Object.fromEntries(topFields(s.requestFields).map((n) => [n, { type: "string" }])) } } },
    };
  }
  openapi.paths[key][s.method.toLowerCase()] = op;
}

// ---- Postman v2.1 (all scenarios, grouped by area) ----
const folders = {};
for (const s of scenarios) {
  const url = s.path.startsWith("http") ? s.path : COMMERCIAL + s.path;
  const u = new URL(url);
  folders[s.area] ??= { name: s.area, item: [] };
  folders[s.area].item.push({
    name: s.title,
    request: {
      method: s.method,
      header: (s.headers ?? []).map((h) => ({ key: h.name, value: h.name.toLowerCase() === "authorization" ? "Bearer {{token}}" : (h.note ?? ""), description: h.note })),
      url: { raw: url, protocol: "https", host: u.host.split("."), path: u.pathname.split("/").filter(Boolean), query: [...u.searchParams].map(([k, v]) => ({ key: k, value: v })) },
      description: (s.gotchas ?? []).join("\n") + `\n\nDocs: ${s.docUrl}`,
    },
  });
}
const postman = {
  info: { name: "Partner Center REST (unofficial, generated)", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json", description: "Generated from partner-center-mcp. Set {{token}} to a bearer access token." },
  item: Object.values(folders).sort((a, b) => a.name.localeCompare(b.name)),
};

writeFileSync(new URL("generated/openapi.json", root), JSON.stringify(openapi, null, 2) + "\n");
writeFileSync(new URL("generated/partner-center.postman_collection.json", root), JSON.stringify(postman, null, 2) + "\n");
console.log(`export: ${Object.keys(openapi.paths).length} OpenAPI paths, ${Object.values(folders).reduce((n, f) => n + f.item.length, 0)} Postman requests across ${Object.keys(folders).length} folders`);
