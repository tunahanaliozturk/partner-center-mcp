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

export interface Tool {
  name: string;
  description: string;
  inputShape: z.ZodRawShape;
  // Each tool narrows its own args via its Zod inputShape, so a shared concrete
  // type here would not fit any of them.
  // biome-ignore lint/suspicious/noExplicitAny: see above
  run(args: any, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}
