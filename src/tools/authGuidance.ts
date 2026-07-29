import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";

export const authGuidance: Tool = {
  name: "pc_auth_guidance",
  title: "Get authentication guidance",
  description:
    "Return how to authenticate against Partner Center for a given token flavour and national cloud: the token resource and authority to use, the ordered steps of the flow, Secure Application Model and MFA requirements, and what is deprecated. " +
    "Use this when deciding or setting up how to get a token. To check whether existing code already uses a retired pattern, use pc_check_auth instead; to decode a 401/403 you already hit, use pc_decode_error. " +
    "Read-only, offline, deterministic. Returns guidance only — it issues no tokens, contacts no identity provider, and handles no secrets.",
  inputShape: {
    authType: z.enum(["app-only", "app+user"]).describe(
      "Which token flavour to describe. \"app+user\" is the Secure Application Model refresh-token flow required by most Partner Center operations; " +
      "\"app-only\" is application permissions, which only a subset of endpoints accept. Required — check a scenario's authType with pc_get_scenario if unsure.",
    ),
    cloud: z.enum(["commercial", "china-21vianet", "us-gov"]).optional().describe(
      "Sovereign cloud whose endpoints and authority to return. Defaults to \"commercial\". " +
      "Choose \"china-21vianet\" or \"us-gov\" only for tenants in those clouds — their authorities and feature availability differ.",
    ),
  },
  outputShape: envelope(
    z.object({
      cloud: z.object({
        tokenResource: z.string().describe("Audience/resource to request the token for."),
        authority: z.string().describe("Login authority host for this cloud."),
      }).describe("Endpoints for the requested cloud."),
      pattern: z.unknown().describe("The flow for the requested authType: ordered steps plus Secure Application Model and MFA notes for app+user, or the supported-endpoints note for app-only."),
      deprecations: z.array(z.object({
        what: z.string().describe("The retired or deprecated mechanism."),
        status: z.string().describe("Where it stands, e.g. retired or enforced."),
        fix: z.string().describe("What to move to."),
      })).describe("Auth mechanisms you must not build on."),
    }),
    { suggests: true },
  ),
  annotations: OFFLINE,
  run(args, ctx) {
    const auth = (ctx.knowledge as Knowledge).auth;
    const cloudKey = args.cloud ?? "commercial";
    const cloud = auth.clouds[cloudKey];
    if (!cloud) return notFound(`No auth data for cloud "${cloudKey}".`, Object.keys(auth.clouds));
    const pattern = auth.patterns[args.authType as "app-only" | "app+user"];
    return ok({ cloud, pattern, deprecations: auth.deprecations });
  },
};
