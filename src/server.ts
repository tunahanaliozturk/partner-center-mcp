import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool, ToolContext } from "./types.js";

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
  return server;
}
