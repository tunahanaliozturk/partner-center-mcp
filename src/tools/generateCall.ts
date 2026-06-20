import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge, Scenario } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";

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
  description: "Generate a current Partner Center REST call for a scenario in the chosen language, with optional auth/retry/pagination boilerplate. Never emits the archived .NET SDK.",
  inputShape: {
    id: z.string(),
    language: z.enum(["curl", "csharp", "typescript", "powershell"]),
    includeHelpers: z.boolean().optional(),
  },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenario = k.scenarios.find((s) => s.id === args.id);
    if (!scenario) return notFound(`No scenario with id "${args.id}".`, k.scenarios.map((s) => s.id));
    const lang = args.language as Lang;
    // powershell is derived from the path when no curated example exists.
    const code = lang === "powershell"
      ? `# PowerShell (Invoke-RestMethod)\nInvoke-RestMethod -Method ${scenario.method} -Uri "https://api.partnercenter.microsoft.com${scenario.path}" -Headers @{ Authorization = "Bearer $token" }`
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
