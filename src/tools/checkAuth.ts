import { z } from "zod";
import type { Tool } from "../types.js";
import { ok } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";

interface Rule { pattern: RegExp; severity: "error" | "warning"; message: string; fix: string; docUrl: string }

const RULES: Rule[] = [
  {
    pattern: /graph\.windows\.net/i,
    severity: "error",
    message: "Uses the retired graph.windows.net audience; Partner Center returns 401 / 900420.",
    fix: "Request the token with resource https://api.partnercenter.microsoft.com.",
    docUrl: "https://learn.microsoft.com/partner-center/developer/deprecate-azure-active-directory-graph-token",
  },
  {
    pattern: /AuthenticationContext|ActiveDirectory\.Library|\bADAL\b/i,
    severity: "warning",
    message: "Appears to use ADAL (Azure AD Authentication Library), which is deprecated.",
    fix: "Use MSAL with the secure application model.",
    docUrl: "https://learn.microsoft.com/partner-center/developer/enable-secure-app-model",
  },
  {
    pattern: /IAggregatePartner|PartnerService\.Instance|partner-center-sdk/i,
    severity: "warning",
    message: "References the archived Partner Center .NET SDK (3.4.0, archived June 2023).",
    fix: "Call the Partner Center REST APIs directly. Use pc_migrate_from_sdk to translate.",
    docUrl: "https://learn.microsoft.com/partner-center/developer/get-started",
  },
  {
    pattern: /Install-Module\s+(AzureAD|MSOnline)|Connect-AzureAD|Connect-MsolService/i,
    severity: "warning",
    message: "Uses the deprecated AzureAD/MSOnline PowerShell modules.",
    fix: "Use the Microsoft.Graph PowerShell module (and the community Partner Center PowerShell module) with the secure application model.",
    docUrl: "https://learn.microsoft.com/partner-center/developer/enable-secure-app-model",
  },
  {
    pattern: /resource=https?%3a%2f%2fgraph\.windows\.net|aadgraph|graph\.windows\.net\/\.default/i,
    severity: "error",
    message: "Requests a token for the retired Azure AD Graph (graph.windows.net) audience; Partner Center returns 401 / 900420.",
    fix: "Request the token with resource https://api.partnercenter.microsoft.com.",
    docUrl: "https://learn.microsoft.com/partner-center/developer/deprecate-azure-active-directory-graph-token",
  },
];

export const checkAuth: Tool = {
  name: "pc_check_auth",
  title: "Lint auth code for retired patterns",
  description:
    "Scan a Partner Center auth or client code snippet for retired and deprecated patterns — the graph.windows.net token audience, ADAL, the archived .NET SDK, and the AzureAD/MSOnline PowerShell modules — and return the severity, explanation, fix, and doc link for each hit. " +
    "Use this to triage existing code before or after a 401. For guidance on what to build instead, use pc_auth_guidance; to translate archived SDK calls into REST, use pc_migrate_from_sdk. " +
    "Read-only, offline, deterministic pattern matching: the snippet is not executed, nothing is sent anywhere, and no code is modified. " +
    "A clean snippet returns findings: [] with clean: true. Detection is regex-based, so a clean result is not a guarantee of correctness.",
  inputShape: {
    code: z.string().describe(
      "The code to lint, pasted as-is. Any language — C#, TypeScript, PowerShell, or a raw token request URL. " +
      "A partial snippet is fine: only the auth-related lines matter, and matching is case-insensitive. Secrets are matched against locally and never transmitted, but paste redacted code where you can.",
    ),
  },
  outputShape: envelope(z.object({
    findings: z.array(z.object({
      pattern: z.string().describe("Source of the regex that matched, so you can see exactly what was detected."),
      severity: z.enum(["error", "warning"]).describe("\"error\" means the code is already broken against the live API; \"warning\" means deprecated but still working."),
      message: z.string().describe("What was detected and why it is a problem."),
      fix: z.string().describe("The concrete change to make."),
      docUrl: z.string().describe("Microsoft Learn page covering the retirement or its replacement."),
    })).describe("One entry per matched pattern. Empty when nothing matched."),
    clean: z.boolean().describe("True when no pattern matched. Means only that these specific retirements were not found, not that the code is correct overall."),
  })),
  annotations: OFFLINE,
  run(args) {
    const findings = RULES.filter((r) => r.pattern.test(args.code)).map((r) => ({
      pattern: r.pattern.source,
      severity: r.severity, message: r.message, fix: r.fix, docUrl: r.docUrl,
    }));
    return ok({ findings, clean: findings.length === 0 });
  },
};
