import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { EXTRACTOR_VERSION, SnapshotSchema, type Snapshot } from "./types.js";

// Deliberately outside data/: package.json's `files` publishes data/ to npm,
// and this is build-time tooling data that no consumer of the package needs.
export const SNAPSHOT_PATH = "verification/doc-facts.json";

export function emptySnapshot(version: string): Snapshot {
  return { version, extractorVersion: EXTRACTOR_VERSION, tocHrefs: [], pages: {} };
}

export function readSnapshot(path: string = SNAPSHOT_PATH): Snapshot {
  if (!existsSync(path)) {
    throw new Error(`${path}: missing. Run \`npm run docfacts:refresh\` to create it.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path}: cannot parse (${(e as Error).message})`);
  }
  const result = SnapshotSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const detail = issue ? `${issue.path.join(".")}: ${issue.message}` : result.error.message;
    throw new Error(`${path}: invalid (${detail})`);
  }
  return result.data;
}

export function writeSnapshot(snapshot: Snapshot, path: string = SNAPSHOT_PATH): void {
  const pages: Snapshot["pages"] = {};
  for (const url of Object.keys(snapshot.pages).sort()) {
    const facts = snapshot.pages[url];
    if (facts) pages[url] = facts;
  }
  const sorted: Snapshot = { ...snapshot, tocHrefs: [...snapshot.tocHrefs].sort(), pages };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
}
