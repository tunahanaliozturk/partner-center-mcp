import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge, Scenario } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";
import { baseUrlFor } from "../knowledge/apis.js";

type Lang = "curl" | "csharp" | "typescript" | "powershell";

// Reusable boilerplate per language: Secure App Model token exchange plus
// 429/Retry-After + 202 polling + pagination handling. Stored as double-quoted
// lines so the embedded ${...} and backticks stay literal in the source.
const HELPERS: Record<Lang, string> = {
  curl: [
    "# Secure App Model: exchange a stored refresh token for a Partner Center access token.",
    "TOKEN=$(curl -s -X POST \"https://login.microsoftonline.com/$PC_TENANT_ID/oauth2/token\" \\",
    "  -d \"grant_type=refresh_token&resource=https://api.partnercenter.microsoft.com&client_id=$PC_CLIENT_ID&client_secret=$PC_CLIENT_SECRET&refresh_token=$PC_REFRESH_TOKEN\" \\",
    "  | jq -r .access_token)",
    "# Add: --retry 5 --retry-delay 2 to respect throttling (HTTP 429 Retry-After).",
  ].join("\n"),
  typescript: [
    "// Secure App Model: exchange a stored refresh token for a Partner Center access token.",
    "async function getAccessToken(): Promise<string> {",
    "  const res = await fetch(`https://login.microsoftonline.com/${process.env.PC_TENANT_ID}/oauth2/token`, {",
    "    method: \"POST\",",
    "    headers: { \"Content-Type\": \"application/x-www-form-urlencoded\" },",
    "    body: new URLSearchParams({",
    "      grant_type: \"refresh_token\",",
    "      resource: \"https://api.partnercenter.microsoft.com\",",
    "      client_id: process.env.PC_CLIENT_ID!,",
    "      client_secret: process.env.PC_CLIENT_SECRET!,",
    "      refresh_token: process.env.PC_REFRESH_TOKEN!,",
    "    }),",
    "  });",
    "  if (!res.ok) throw new Error(`token request failed: ${res.status}`);",
    "  return (await res.json()).access_token as string;",
    "}",
    "",
    "// Retry on 429 (Retry-After) and follow 202 Location for long-running writes.",
    "async function pcFetch(url: string, init: RequestInit = {}): Promise<Response> {",
    "  for (let attempt = 0; ; attempt++) {",
    "    const res = await fetch(url, init);",
    "    if (res.status === 429 && attempt < 5) {",
    "      const wait = Number(res.headers.get(\"retry-after\")) || 2 ** attempt;",
    "      await new Promise(r => setTimeout(r, wait * 1000));",
    "      continue;",
    "    }",
    "    const loc = res.headers.get(\"location\");",
    "    if (res.status === 202 && loc) {",
    "      await new Promise(r => setTimeout(r, 2000));",
    "      return pcFetch(loc, { headers: init.headers });",
    "    }",
    "    return res;",
    "  }",
    "}",
    "",
    "// Page through a Partner Center collection (follow links.next).",
    "async function* pcPaginate(url: string, token: string) {",
    "  let next: string | undefined = url;",
    "  while (next) {",
    "    const res = await pcFetch(next, { headers: { Authorization: `Bearer ${token}` } });",
    "    const page = await res.json();",
    "    for (const item of page.items ?? []) yield item;",
    "    next = page.links?.next?.uri;",
    "  }",
    "}",
  ].join("\n"),
  csharp: [
    "// Secure App Model: exchange a stored refresh token for a Partner Center access token.",
    "static async Task<string> GetAccessTokenAsync(HttpClient http) {",
    "  var form = new FormUrlEncodedContent(new Dictionary<string, string> {",
    "    [\"grant_type\"] = \"refresh_token\",",
    "    [\"resource\"] = \"https://api.partnercenter.microsoft.com\",",
    "    [\"client_id\"] = Environment.GetEnvironmentVariable(\"PC_CLIENT_ID\")!,",
    "    [\"client_secret\"] = Environment.GetEnvironmentVariable(\"PC_CLIENT_SECRET\")!,",
    "    [\"refresh_token\"] = Environment.GetEnvironmentVariable(\"PC_REFRESH_TOKEN\")!,",
    "  });",
    "  var tenant = Environment.GetEnvironmentVariable(\"PC_TENANT_ID\");",
    "  var res = await http.PostAsync($\"https://login.microsoftonline.com/{tenant}/oauth2/token\", form);",
    "  res.EnsureSuccessStatusCode();",
    "  using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());",
    "  return doc.RootElement.GetProperty(\"access_token\").GetString()!;",
    "}",
    "// On HTTP 429 honor the Retry-After header and retry; long-running writes return",
    "// 202 with a Location header to poll. Page collections via the response 'links.next'.",
  ].join("\n"),
  powershell: [
    "# Secure App Model: exchange a stored refresh token for a Partner Center access token.",
    "$body = @{ grant_type='refresh_token'; resource='https://api.partnercenter.microsoft.com';",
    "  client_id=$env:PC_CLIENT_ID; client_secret=$env:PC_CLIENT_SECRET; refresh_token=$env:PC_REFRESH_TOKEN }",
    "$token = (Invoke-RestMethod -Method Post -Uri \"https://login.microsoftonline.com/$($env:PC_TENANT_ID)/oauth2/token\" -Body $body).access_token",
    "# On HTTP 429 honor Retry-After; long-running writes return 202 with a Location header to poll.",
  ].join("\n"),
};

function notesFor(s: Scenario): string[] {
  const notes: string[] = [];
  const isCollection = /collection/i.test(String(s.responseShape ?? ""));
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(s.method);
  if (isCollection) notes.push("Paginate: follow links.next in each response until it is absent.");
  if (isWrite) notes.push("Idempotency: send a unique MS-RequestId and reuse the same value on retries.");
  notes.push("Throttling: on HTTP 429, honor the Retry-After header and back off before retrying.");
  notes.push("Long-running writes may return HTTP 202 with a Location header — poll it until the operation completes.");
  if (s.authType === "app+user") notes.push("This scenario needs an App+User (secure application model) token.");
  return notes;
}

export const generateCall: Tool = {
  name: "pc_generate_call",
  title: "Generate REST call code",
  description:
    "Emit ready-to-adapt code for one Partner Center scenario in the language you ask for, plus the Secure Application Model token exchange, 429 retry, 202 polling, and pagination boilerplate. " +
    "Use this when you want code. For a structured method/url/headers/body object to send yourself, use pc_build_request; for the underlying facts and gotchas, use pc_get_scenario. " +
    "Only current REST is emitted — never the archived .NET SDK. " +
    "Read-only, offline, deterministic: the code is returned as text and is never executed, and the placeholder credentials it contains are read from environment variables at your end. " +
    "An unknown id returns ok:false with `suggestions` listing every valid id.",
  inputShape: {
    id: z.string().describe(
      "Exact scenario id in kebab-case, e.g. \"create-cart\". Case-sensitive; discover ids with pc_list_scenarios or any pc_plan_* tool.",
    ),
    language: z.enum(["curl", "csharp", "typescript", "powershell"]).describe(
      "Target language for the snippet. Required — there is no default. " +
      "\"curl\", \"csharp\", and \"typescript\" come from curated per-scenario examples; \"powershell\" is generated from the endpoint definition and is therefore more skeletal.",
    ),
    includeHelpers: z.boolean().optional().describe(
      "Whether to append the reusable boilerplate — token exchange, 429/Retry-After handling, 202 polling, pagination — as a separate `helpers` field. " +
      "Defaults to true. Set false when you already have that plumbing and only want the call itself.",
    ),
  },
  outputShape: envelope(
    z.object({
      language: z.enum(["curl", "csharp", "typescript", "powershell"]).describe("Language the snippet was emitted in."),
      code: z.string().describe("The call itself, with {placeholder} path segments left for you to substitute."),
      helpers: z.string().optional().describe("Reusable auth, retry, polling, and pagination boilerplate. Present unless includeHelpers was false."),
      notes: z.array(z.string()).describe("Operational requirements for this specific call: pagination, MS-RequestId idempotency, throttling, 202 polling, token flavour."),
      authType: z.enum(["app-only", "app+user"]).describe("Token flavour this call requires."),
      method: z.string().describe("HTTP verb."),
      path: z.string().describe("API-relative path with placeholders."),
      docUrl: z.string().describe("Microsoft Learn page documenting this operation."),
    }),
    { suggests: true },
  ),
  annotations: OFFLINE,
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenario = k.scenarios.find((s) => s.id === args.id);
    if (!scenario) return notFound(`No scenario with id "${args.id}".`, k.scenarios.map((s) => s.id));
    const lang = args.language as Lang;
    const fullUrl = baseUrlFor(scenario.api) + scenario.path;
    // powershell is derived from the path when no curated example exists.
    const code = lang === "powershell"
      ? `# PowerShell (Invoke-RestMethod)\nInvoke-RestMethod -Method ${scenario.method} -Uri "${fullUrl}" -Headers @{ Authorization = "Bearer $token" }`
      : scenario.examples[lang as "curl" | "csharp" | "typescript"];
    const includeHelpers = args.includeHelpers !== false; // default on
    return ok({
      language: lang,
      code,
      ...(includeHelpers ? { helpers: HELPERS[lang] } : {}),
      notes: notesFor(scenario),
      authType: scenario.authType,
      method: scenario.method,
      path: scenario.path,
      docUrl: scenario.docUrl,
    });
  },
};
