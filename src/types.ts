import type { z } from "zod";
import type { Knowledge } from "./knowledge/schema.js";

export type { Knowledge };

// DocFetch returns curated-or-live doc excerpts; concrete impl arrives in a later task.
export type DocFetch = (query: string, opts?: { timeoutMs?: number }) =>
  Promise<{ ok: boolean; excerpts: { title: string; url: string; text: string }[]; note?: string }>;

export interface ToolContext {
  knowledge: Knowledge;
  docFetch: DocFetch;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  suggestions?: string[];
}

// MCP tool behaviour hints (see the spec's ToolAnnotations). Every tool here
// declares them explicitly so a calling agent can tell, without invoking the
// tool, whether it mutates anything and whether it reaches the network.
export interface ToolBehaviour {
  /** Never mutates Partner Center or any other remote state. True for every tool in this server. */
  readOnlyHint: true;
  /** Never deletes or overwrites anything. True for every tool in this server. */
  destructiveHint: false;
  /** Same input always yields the same output (only false where live docs are fetched). */
  idempotentHint: boolean;
  /** Reaches out to the public internet (Microsoft Learn) rather than only the bundled pack. */
  openWorldHint: boolean;
}

export interface Tool {
  name: string;
  /** Short human-readable label for tool pickers; falls back to `name` when absent. */
  title: string;
  description: string;
  inputShape: z.ZodRawShape;
  /** Shape of the JSON envelope this tool returns, declared for structured output. */
  outputShape: z.ZodRawShape;
  annotations: ToolBehaviour;
  // Each tool narrows its own args via its Zod inputShape, so a shared concrete
  // type here would not fit any of them.
  // biome-ignore lint/suspicious/noExplicitAny: see above
  run(args: any, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}
