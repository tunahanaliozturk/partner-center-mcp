import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, toolError } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";
import { findScenarios } from "../knowledge/lookup.js";

const ScenarioChange = z.object({
  id: z.string(),
  title: z.string().describe("Empty when the scenario was removed and is no longer in the pack."),
  method: z.string(),
  path: z.string(),
  docUrl: z.string(),
});

export const diffPack: Tool = {
  name: "pc_diff_pack",
  title: "See what changed between knowledge pack releases",
  description:
    "Return the scenarios added, changed, or removed across releases of this pack, newest first. " +
    "Use it to find out what moved since the version you last built against: a changed scenario means its route, auth, headers, request fields, response shape, or documented constraints are not what they were. " +
    "This tracks THIS PACK, which follows Microsoft Learn. It is the closest thing here to an API changelog, but it is not Microsoft's. " +
    "For deprecations and enforcement deadlines use pc_whats_new instead; for one scenario's current detail use pc_get_scenario. " +
    "Read-only, offline, deterministic.",
  inputShape: {
    since: z.string().optional().describe(
      "Only report releases after this pack version, e.g. \"0.15.0\". Omit for the full recorded history. " +
      "A version with no recorded release comes back as ok:false listing the versions that do exist.",
    ),
    id: z.string().optional().describe(
      "Only report releases that touched this scenario id. Combine with `since` to ask whether one operation moved.",
    ),
  },
  outputShape: envelope(z.object({
    releases: z.array(z.object({
      version: z.string(),
      date: z.string(),
      scenarioCount: z.number().describe("Total scenarios in the pack at that release."),
      added: z.array(ScenarioChange),
      changed: z.array(ScenarioChange).describe("Route, auth, headers, fields, response shape or gotchas differ from the release before."),
      removed: z.array(ScenarioChange),
    })),
    notes: z.array(z.string()),
  })),
  annotations: OFFLINE,
  run(args, ctx): ToolResult {
    const k = ctx.knowledge as Knowledge;
    const all = k.history;

    if (args.since !== undefined && !all.some((r) => r.version === args.since)) {
      return toolError(
        `No recorded release "${args.since}". Recorded: ${all.map((r) => r.version).join(", ") || "none yet"}.`,
      );
    }

    // Releases are stored newest first, so everything before the named version
    // in the array is what came after it.
    const cut = args.since === undefined ? all.length : all.findIndex((r) => r.version === args.since);
    let releases = all.slice(0, cut);

    if (args.id !== undefined) {
      // Narrow to the one id as well as filtering: asking about a scenario
      // should answer for that scenario, not hand back everything that shipped
      // in the same release.
      const only = (ids: string[]) => ids.filter((x) => x === args.id);
      releases = releases
        .map((r) => ({ ...r, added: only(r.added), changed: only(r.changed), removed: only(r.removed) }))
        .filter((r) => r.added.length + r.changed.length + r.removed.length > 0);
    }

    // Ids are expanded into records so a caller can see what moved without a
    // second lookup per id. A removed scenario is no longer in the pack, so it
    // is reported as a bare id.
    const expand = (ids: string[]) => {
      const found = findScenarios(k, ids);
      const byId = new Map(found.map((s) => [s.id, s]));
      return ids.map((id) => {
        const s = byId.get(id);
        return s
          ? { id, title: s.title, method: s.method, path: s.path, docUrl: s.docUrl }
          : { id, title: "", method: "", path: "", docUrl: "" };
      });
    };

    const notes = [
      "A scenario counts as changed when its method, path, api, auth type, headers, request fields, request or response shape, gotchas, or doc link differ. Re-verification alone is not a change.",
      "Release versions are this pack's, not Microsoft's. Microsoft's own deadlines are in pc_whats_new.",
    ];
    if (releases.length === 0) {
      notes.push(args.id !== undefined
        ? `No recorded release touched "${args.id}".`
        : "Nothing recorded for that range.");
    }

    return ok({
      releases: releases.map((r) => ({
        version: r.version,
        date: r.date,
        scenarioCount: r.scenarioCount,
        added: expand(r.added),
        changed: expand(r.changed),
        removed: expand(r.removed),
      })),
      notes,
    });
  },
};
