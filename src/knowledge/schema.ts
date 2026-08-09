import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "lastVerified must be YYYY-MM-DD");

export const AREAS = [
  "customers", "subscriptions", "orders", "licenses", "invoicing", "profiles", "auth",
  "catalog", "utilities", "audit", "support", "security", "analytics",
  "devices", "referrals",
] as const;

export const ScenarioSchema = z.object({
  id: z.string().describe("Stable kebab-case identifier, e.g. \"create-cart\". Pass this to pc_get_scenario, pc_generate_call, or pc_build_request."),
  area: z.enum(AREAS).describe("Functional area of the Partner Center API this operation belongs to."),
  title: z.string().describe("Human-readable name of the operation."),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).describe("HTTP verb for the call."),
  // Absent means "partner-center": the default host a relative path resolves
  // against. See src/knowledge/apis.ts for the base each api id maps to.
  api: z.enum(["partner-center", "graph", "pricing-and-referrals", "customer-service-admin"]).optional()
    .describe("Which API surface hosts this operation. Absent means \"partner-center\". GDAP and reconciliation-v2 operations are \"graph\" and need a different token audience."),
  path: z.string().describe("API-relative path with {placeholder} segments, e.g. \"/v1/customers/{customer-id}/subscriptions\". Resolve it against the base URL for `api`."),
  authType: z.enum(["app-only", "app+user"]).describe("Token flavour the operation requires. \"app+user\" needs the Secure Application Model refresh-token flow."),
  headers: z.array(z.object({
    name: z.string().describe("Header name."),
    required: z.boolean().describe("Whether the call fails without it."),
    note: z.string().optional().describe("What to put in the header and why."),
  })).describe("Request headers this operation expects."),
  requestShape: z.union([z.string(), z.null()]).describe("JSON body template, or null for operations that take no body."),
  requestFields: z.array(z.object({
    name: z.string().describe("Field path within the request body; \"[]\" marks an array hop, e.g. \"lineItems[].catalogItemId\"."),
    type: z.string().describe("Declared type of the field."),
    required: z.boolean().describe("Whether the request is rejected without it."),
    note: z.string().optional().describe("Constraints, accepted values, or gotchas for this field."),
  })).optional().describe("Per-field documentation for the request body, when the operation takes one."),
  responseShape: z.union([z.string(), z.null()]).describe("JSON response template, or null when the operation returns no body."),
  examples: z.object({
    curl: z.string().describe("Runnable curl invocation."),
    csharp: z.string().describe("C# HttpClient snippet."),
    typescript: z.string().describe("TypeScript fetch snippet."),
  }).describe("Ready-to-adapt request examples per language."),
  gotchas: z.array(z.string()).describe("Pitfalls that commonly break this call in practice, most consequential first."),
  docUrl: z.string().url().describe("Microsoft Learn page documenting this operation."),
  lastVerified: isoDate.describe("YYYY-MM-DD on which this entry was last checked against the live documentation."),
});

export const ErrorEntrySchema = z.object({
  httpStatus: z.number().describe("HTTP status code the API returns with this error."),
  errorCode: z.string().describe("Partner Center error code, e.g. \"900400\"."),
  description: z.string().describe("What the error means."),
  causes: z.array(z.string()).describe("Known conditions that trigger it."),
  remediation: z.string().describe("Concrete fix to apply."),
  docUrl: z.string().url().describe("Microsoft Learn page covering this error."),
  relatedScenarios: z.array(z.string()).optional().describe("Scenario ids where this error commonly surfaces."),
});

export const AuthSchema = z.object({
  clouds: z.record(z.string(), z.object({ tokenResource: z.string(), authority: z.string() })),
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
  baseUrls: z.record(z.string(), z.string()),
  headers: z.array(z.object({ name: z.string(), purpose: z.string() })),
  versioning: z.string(),
  sandbox: z.string(),
  rateLimits: z.string(),
  nationalClouds: z.string(),
});

export const EnumsSchema = z.object({
  version: z.string(),
  enums: z.record(z.string(), z.object({
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
  resources: z.record(z.string(), z.object({
    description: z.string(),
    fields: z.array(z.object({ name: z.string(), type: z.string(), note: z.string().optional() })),
    docUrl: z.string().url().optional(),
  })),
});

/**
 * The subscription lifecycle as a state machine. The scenario pack answers
 * "what is the endpoint"; this answers "what can I do to this subscription
 * right now, and what decides that" - the question a license manager actually
 * asks. Guards are stated as a field to READ off the live subscription rather
 * than as a duration, because Microsoft has changed the cancellation window
 * before and a number baked in here would quietly rot.
 */
export const LifecycleSchema = z.object({
  version: z.string(),
  states: z.array(z.string()).describe("Every state a subscription can be in."),
  operations: z.array(z.object({
    operation: z.string().describe("Stable operation name, e.g. \"decrease-seats\"."),
    title: z.string().describe("Human-readable name of the operation."),
    fromStates: z.array(z.string()).describe("States the operation is legal from."),
    toState: z.string().describe("State the subscription is in once it succeeds."),
    scenarioId: z.string().describe("Scenario that performs it; pass to pc_get_scenario or pc_generate_call."),
    guard: z.union([z.object({
      field: z.string().describe("Field to read off the live subscription before attempting the operation."),
      condition: z.string().describe("Condition that must hold for the operation to be accepted."),
    }), z.null()]).describe("Precondition to evaluate against the live subscription, or null when unconditional."),
    errorCodes: z.array(z.string()).describe("Error codes returned when the guard fails; decode them with pc_lookup_error."),
    notes: z.array(z.string()).describe("Constraints worth knowing before calling."),
  })),
});


/**
 * Response examples lifted verbatim from each Learn page, keyed by scenario id.
 *
 * Kept out of ScenarioSchema on purpose: the bodies are large, and pc_list_scenarios
 * would otherwise carry them on every entry it returns. Not every scenario has one,
 * because not every page publishes an example and nothing here is invented.
 */
export const ExamplesSchema = z.object({
  version: z.string(),
  examples: z.record(z.string(), z.object({
    httpStatus: z.union([z.number(), z.null()]).describe("Status from the example response, or null when the page stated none."),
    body: z.unknown().describe("The example response body, exactly as the page publishes it."),
    docUrl: z.string().url().describe("The page the example was taken from."),
  })),
});


/**
 * Which scenario yields each path placeholder.
 *
 * Small and curated on purpose: most placeholders are caller-supplied query
 * parameters, and only resource ids are actually obtained from another call.
 * whenPathContains disambiguates a token that means different things on
 * different routes, such as policy-id.
 */
export const PrerequisitesSchema = z.object({
  version: z.string(),
  producers: z.array(z.object({
    placeholder: z.string().describe("The path placeholder this entry explains, without braces."),
    producedBy: z.string().describe("Scenario id whose response yields it."),
    whenPathContains: z.string().optional().describe("Only applies to target paths containing this fragment."),
    note: z.string().describe("How to get the value out of that call."),
  })),
});

export type PrerequisiteProducer = z.infer<typeof PrerequisitesSchema>["producers"][number];


/**
 * What changed between releases of this pack, newest first.
 *
 * Written by scripts/pack-diff.mjs at release time from a fingerprint of every
 * scenario, so a release entry reflects real differences rather than an author
 * remembering to write one.
 */
export const HistorySchema = z.object({
  version: z.string(),
  releases: z.array(z.object({
    version: z.string().describe("Pack version this release shipped as."),
    date: isoDate,
    scenarioCount: z.number().describe("Total scenarios at that release."),
    added: z.array(z.string()),
    changed: z.array(z.string()),
    removed: z.array(z.string()),
  })),
});

export type ReleaseEntry = z.infer<typeof HistorySchema>["releases"][number];


/**
 * How Partner Center BEHAVES, as opposed to what its endpoints are.
 *
 * The scenario pack answers "what do I call and how". A licensing team asks
 * something else: what the cancellation window actually depends on, what happens
 * to subscriptions when a GDAP relationship expires, whether a promotion limit
 * counts licences another partner already sold. None of that is a request or a
 * response, and none of it can be derived from one.
 *
 * Each entry is keyed by the QUESTION it answers, because that is how the
 * question arrives. The rule states the behaviour, and consequence states what
 * goes wrong when the rule is not known, which is usually why anyone is asking.
 */
export const PoliciesSchema = z.object({
  version: z.string(),
  policies: z.array(z.object({
    id: z.string().describe("Stable kebab-case identifier."),
    area: z.enum(["customers", "billing", "pricing", "security", "lifecycle", "announcements"])
      .describe("Which part of running a CSP practice this belongs to."),
    question: z.string().describe("The question as somebody managing licences would ask it."),
    rule: z.string().describe("What Partner Center actually does. The answer."),
    consequence: z.string().optional()
      .describe("What goes wrong when this is not known. Usually the reason the question came up."),
    relatedScenarios: z.array(z.string()).optional()
      .describe("Scenario ids that carry this rule out; pass to pc_get_scenario."),
    relatedErrors: z.array(z.string()).optional()
      .describe("Error codes this rule explains; decode with pc_lookup_error."),
    docUrl: z.string().url().describe("Microsoft Learn page the rule was read from."),
    lastVerified: isoDate,
  })),
});

export type Policy = z.infer<typeof PoliciesSchema>["policies"][number];

export type ExamplesData = z.infer<typeof ExamplesSchema>["examples"];
export type LifecycleData = z.infer<typeof LifecycleSchema>;
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
  lifecycle: LifecycleData;
  examples: ExamplesData;
  prerequisites: PrerequisiteProducer[];
  history: ReleaseEntry[];
  policies: Policy[];
}
