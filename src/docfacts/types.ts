import { z } from "zod";

/**
 * Bump when extraction logic changes. Every snapshot record changes with it,
 * so the version turns that churn into one deliberate re-baseline instead of
 * a few hundred phantom drift findings.
 */
export const EXTRACTOR_VERSION = 3;

export const DocFactsSchema = z.object({
  url: z.string().url(),
  finalUrl: z.string().url(),
  template: z.enum(["partner-center", "graph", "unknown"]),
  documentId: z.union([z.string(), z.null()]),
  sourceRepo: z.union([z.string(), z.null()]),
  sourceSha: z.union([z.string(), z.null()]),
  sourcePath: z.union([z.string(), z.null()]),
  msDate: z.union([z.string(), z.null()]),
  updatedAt: z.union([z.string(), z.null()]),
  title: z.union([z.string(), z.null()]),
  requestSyntax: z.union([z.object({ method: z.string(), uri: z.string() }), z.null()]),
  requestSyntaxes: z.array(z.object({ method: z.string(), uri: z.string() })),
  headerNames: z.array(z.string()),
  bodyFields: z.array(z.object({ name: z.string(), type: z.string() })),
  isEndpointPage: z.boolean(),
  extractionError: z.union([z.string(), z.null()]),
  extractorVersion: z.number(),
});

export const SnapshotSchema = z.object({
  version: z.string(),
  extractorVersion: z.number(),
  tocHrefs: z.array(z.string()),
  pages: z.record(z.string(), DocFactsSchema),
});

export type DocFacts = z.infer<typeof DocFactsSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
