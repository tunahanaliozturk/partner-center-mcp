import { createHash } from "node:crypto";
import type { Scenario } from "./schema.js";

/**
 * A stable fingerprint of everything about a scenario that a caller could build
 * against: the route, how it is authenticated, what goes in, what comes back,
 * and the constraints. Prose that does not change behaviour is excluded, so a
 * reworded title does not read as an API change.
 *
 * lastVerified is deliberately absent. Re-verifying a scenario is not a change
 * to it, and including the date would mark the whole pack changed every sweep.
 */
export function fingerprintScenario(s: Scenario): string {
  const material = JSON.stringify([
    s.method,
    s.path,
    s.api ?? "partner-center",
    s.authType,
    s.headers.map((h) => [h.name, h.required]).sort(),
    (s.requestFields ?? []).map((f) => [f.name, f.type, f.required]).sort(),
    s.requestShape,
    s.responseShape,
    s.gotchas,
    s.docUrl,
  ]);
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

export function fingerprintPack(scenarios: readonly Scenario[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of [...scenarios].sort((a, b) => a.id.localeCompare(b.id))) {
    out[s.id] = fingerprintScenario(s);
  }
  return out;
}

export interface PackDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function diffFingerprints(
  before: Record<string, string>,
  after: Record<string, string>,
): PackDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [id, hash] of Object.entries(after)) {
    if (!(id in before)) added.push(id);
    else if (before[id] !== hash) changed.push(id);
  }
  for (const id of Object.keys(before)) {
    if (!(id in after)) removed.push(id);
  }
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}
