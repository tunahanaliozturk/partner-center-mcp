import type { z } from "zod";

// Knowledge and DocFetch get concrete types in later tasks; widen here so this
// foundational module does not depend on them.
export type Knowledge = unknown;
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
  run(args: any, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}
