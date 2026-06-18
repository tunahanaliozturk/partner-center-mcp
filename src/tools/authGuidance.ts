import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";

export const authGuidance: Tool = {
  name: "pc_auth_guidance",
  description: "Current Partner Center authentication guidance for app-only or app+user, per national cloud, with deprecation and MFA notes.",
  inputShape: {
    authType: z.enum(["app-only", "app+user"]),
    cloud: z.enum(["commercial", "china-21vianet", "us-gov"]).optional(),
  },
  run(args, ctx) {
    const auth = (ctx.knowledge as Knowledge).auth;
    const cloudKey = args.cloud ?? "commercial";
    const cloud = auth.clouds[cloudKey];
    if (!cloud) return notFound(`No auth data for cloud "${cloudKey}".`, Object.keys(auth.clouds));
    return ok({ cloud, pattern: auth.patterns[args.authType], deprecations: auth.deprecations });
  },
};
