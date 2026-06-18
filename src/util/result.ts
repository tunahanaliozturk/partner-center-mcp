import type { ToolResult } from "../types.js";

export const ok = (data: unknown): ToolResult => ({ ok: true, data });
export const notFound = (error: string, suggestions?: string[]): ToolResult =>
  suggestions ? { ok: false, error, suggestions } : { ok: false, error };
export const toolError = (error: string): ToolResult => ({ ok: false, error });
