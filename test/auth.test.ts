import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { authGuidance } from "../src/tools/authGuidance.js";
import { checkAuth } from "../src/tools/checkAuth.js";
import type { ToolContext } from "../src/types.js";

const ctx: ToolContext = { knowledge: loadKnowledge("data"), docFetch: async () => ({ ok: true, excerpts: [] }) };

test("pc_auth_guidance returns the pattern with the current resource and MFA date", async () => {
  const r = await authGuidance.run({ authType: "app+user" }, ctx);
  const data = r.data as any;
  expect(data.cloud.tokenResource).toBe("https://api.partnercenter.microsoft.com");
  expect(data.pattern.mfa.enforcementDate).toBe("2026-04-01");
});

test("pc_check_auth flags the retired graph.windows.net audience", async () => {
  const code = "resource=https://graph.windows.net&grant_type=client_credentials";
  const r = await checkAuth.run({ code }, ctx);
  const data = r.data as any;
  expect(data.clean).toBe(false);
  expect(data.findings.some((f: any) => /graph\.windows\.net/.test(f.message))).toBe(true);
  const gw = data.findings.find((f: any) => /graph\.windows\.net/.test(f.message));
  expect(gw.severity).toBe("error");
  expect(gw.pattern).toBeDefined();
});

test("pc_check_auth reports clean for a correct snippet", async () => {
  const code = "resource=https://api.partnercenter.microsoft.com&grant_type=client_credentials";
  const r = await checkAuth.run({ code }, ctx);
  expect((r.data as any).clean).toBe(true);
});
