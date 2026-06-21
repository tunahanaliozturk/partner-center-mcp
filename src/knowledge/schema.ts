import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "lastVerified must be YYYY-MM-DD");

export const AREAS = [
  "customers", "subscriptions", "orders", "licenses", "invoicing", "profiles", "auth",
  "catalog", "utilities", "audit", "support", "security", "analytics",
  "devices", "referrals",
] as const;

export const ScenarioSchema = z.object({
  id: z.string(),
  area: z.enum(AREAS),
  title: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
  path: z.string(),
  authType: z.enum(["app-only", "app+user"]),
  headers: z.array(z.object({ name: z.string(), required: z.boolean(), note: z.string().optional() })),
  requestShape: z.union([z.string(), z.null()]),
  requestFields: z.array(z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean(),
    note: z.string().optional(),
  })).optional(),
  responseShape: z.union([z.string(), z.null()]),
  examples: z.object({ curl: z.string(), csharp: z.string(), typescript: z.string() }),
  gotchas: z.array(z.string()),
  docUrl: z.string().url(),
  lastVerified: isoDate,
});

export const ErrorEntrySchema = z.object({
  httpStatus: z.number(),
  errorCode: z.string(),
  description: z.string(),
  causes: z.array(z.string()),
  remediation: z.string(),
  docUrl: z.string().url(),
  relatedScenarios: z.array(z.string()).optional(),
});

export const AuthSchema = z.object({
  clouds: z.record(z.object({ tokenResource: z.string(), authority: z.string() })),
  patterns: z.object({
    "app-only": z.object({ steps: z.array(z.string()), tokenRequest: z.string(), supportedNote: z.string() }),
    "app+user": z.object({ steps: z.array(z.string()), secureAppModel: z.string(), mfa: z.object({ enforcementDate: z.string(), note: z.string() }) }),
  }),
  deprecations: z.array(z.object({ what: z.string(), status: z.string(), fix: z.string() })),
});

export const SdkMapSchema = z.object({
  mappings: z.array(z.object({ sdkPattern: z.string(), restScenarioId: z.string(), notes: z.string() })),
});

export const ReferenceSchema = z.object({
  baseUrls: z.record(z.string()),
  headers: z.array(z.object({ name: z.string(), purpose: z.string() })),
  versioning: z.string(),
  sandbox: z.string(),
  rateLimits: z.string(),
  nationalClouds: z.string(),
});

export const EnumsSchema = z.object({
  version: z.string(),
  enums: z.record(z.object({
    description: z.string(),
    values: z.array(z.object({ value: z.string(), note: z.string().optional() })),
    docUrl: z.string().url().optional(),
  })),
});

export const DeprecationsSchema = z.object({
  version: z.string(),
  items: z.array(z.object({
    title: z.string(),
    status: z.enum(["upcoming", "in-progress", "enforced", "retired"]),
    date: isoDate,
    impact: z.string(),
    action: z.string(),
    docUrl: z.string().url().optional(),
  })),
});

export const ResourcesSchema = z.object({
  version: z.string(),
  resources: z.record(z.object({
    description: z.string(),
    fields: z.array(z.object({ name: z.string(), type: z.string(), note: z.string().optional() })),
    docUrl: z.string().url().optional(),
  })),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ErrorEntry = z.infer<typeof ErrorEntrySchema>;
export type AuthData = z.infer<typeof AuthSchema>;
export type SdkMapping = z.infer<typeof SdkMapSchema>["mappings"][number];
export type ReferenceData = z.infer<typeof ReferenceSchema>;
export type EnumsData = z.infer<typeof EnumsSchema>["enums"];
export type DeprecationItem = z.infer<typeof DeprecationsSchema>["items"][number];
export type ResourcesData = z.infer<typeof ResourcesSchema>["resources"];

export interface Knowledge {
  scenarios: Scenario[];
  errors: ErrorEntry[];
  auth: AuthData;
  sdkMap: SdkMapping[];
  reference: ReferenceData;
  enums: EnumsData;
  deprecations: DeprecationItem[];
  resources: ResourcesData;
}
