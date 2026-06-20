import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.js";
import type { Knowledge } from "./knowledge/schema.js";

export function createServer(tools: Tool[], ctx: ToolContext, version = "0.0.0"): McpServer {
  const server = new McpServer({ name: "partner-center-mcp", version });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputShape },
      async (args: unknown) => {
        const result = await tool.run(args, ctx);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      },
    );
  }
  registerResources(server, ctx);
  registerPrompts(server);
  return server;
}

function jsonResource(uri: string, data: unknown) {
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data ?? null, null, 2) }] };
}

// Expose the curated knowledge pack as browsable MCP resources so hosts can
// surface it without a tool call.
function registerResources(server: McpServer, ctx: ToolContext): void {
  const k = () => ctx.knowledge as Partial<Knowledge>;
  const collections: { slug: string; title: string; get: () => unknown }[] = [
    { slug: "scenarios", title: "All Partner Center REST scenarios", get: () => k().scenarios },
    { slug: "errors", title: "Partner Center error codes", get: () => k().errors },
    { slug: "auth", title: "Authentication guidance and deprecations", get: () => k().auth },
    { slug: "reference", title: "Base URLs, headers, versioning, clouds", get: () => k().reference },
    { slug: "sdk-map", title: "Archived .NET SDK -> REST mappings", get: () => k().sdkMap },
  ];
  for (const c of collections) {
    server.registerResource(
      `pc-${c.slug}`,
      `pc://${c.slug}`,
      { title: c.title, description: c.title, mimeType: "application/json" },
      async (uri: URL) => jsonResource(uri.href, c.get()),
    );
  }

  // One resource per scenario: pc://scenario/{id}
  server.registerResource(
    "pc-scenario",
    new ResourceTemplate("pc://scenario/{id}", {
      list: async () => ({
        resources: (k().scenarios ?? []).map((s) => ({
          uri: `pc://scenario/${s.id}`,
          name: s.id,
          description: s.title,
          mimeType: "application/json",
        })),
      }),
    }),
    { title: "A single Partner Center scenario", description: "Full detail for one scenario by id", mimeType: "application/json" },
    async (uri: URL, variables: Record<string, unknown>) => {
      const id = String(variables.id);
      const scenario = (k().scenarios ?? []).find((s) => s.id === id);
      return jsonResource(uri.href, scenario ?? { error: `No scenario with id "${id}".` });
    },
  );
}

const text = (t: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: t } }] });

// Ready-made prompts that orchestrate the tools for common tasks.
function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "migrate-sdk",
    {
      title: "Migrate archived SDK code to REST",
      description: "Translate archived Partner Center .NET SDK code into current REST calls.",
      argsSchema: { code: z.string() },
    },
    ({ code }) => text(
      `The following code uses the archived Partner Center .NET SDK. Modernize it:\n` +
      `1. Run pc_check_auth on it to flag retired auth (graph.windows.net, ADAL, archived SDK).\n` +
      `2. Run pc_migrate_from_sdk to map each SDK call to the equivalent REST scenario.\n` +
      `3. For each mapped scenario, call pc_generate_call to emit current REST code.\n\n` +
      "```\n" + code + "\n```",
    ),
  );

  server.registerPrompt(
    "diagnose-issue",
    {
      title: "Diagnose a Partner Center failure",
      description: "Map an error code or symptom to causes, fixes, and relevant scenarios.",
      argsSchema: { symptom: z.string() },
    },
    ({ symptom }) => text(
      `Diagnose this Partner Center API problem: "${symptom}".\n` +
      `Use pc_lookup_error if it is (or contains) an error code, otherwise pc_diagnose for the symptom, ` +
      `then pc_auth_guidance / pc_get_scenario as needed, and propose a concrete fix.`,
    ),
  );

  server.registerPrompt(
    "plan-purchase",
    {
      title: "Plan a New Commerce purchase",
      description: "Lay out the end-to-end NCE purchase workflow for a customer.",
      argsSchema: { country: z.string().optional() },
    },
    ({ country }) => text(
      `Plan an end-to-end New Commerce purchase${country ? ` for country ${country}` : ""}. ` +
      `Call pc_plan_purchase for the ordered steps, then pc_generate_call for each step's code.`,
    ),
  );
}
