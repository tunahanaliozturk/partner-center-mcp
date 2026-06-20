import { z } from "zod";
import type { Tool } from "../types.js";
import { ok } from "../util/result.js";

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
  description: "Lint a Partner Center auth or client snippet for retired/deprecated patterns (graph.windows.net audience, ADAL, archived SDK) and return fixes.",
  inputShape: { code: z.string() },
  run(args) {
    const findings = RULES.filter((r) => r.pattern.test(args.code)).map((r) => ({
      pattern: r.pattern.source,
      severity: r.severity, message: r.message, fix: r.fix, docUrl: r.docUrl,
    }));
    return ok({ findings, clean: findings.length === 0 });
  },
};
