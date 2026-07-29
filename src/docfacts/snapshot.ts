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
  // The version gate lives here, not in one CLI, because EVERY consumer of the
  // snapshot reads through this function: check-pack, check-docs, and the
  // coverage report alike. Gating in a single script would leave the others
  // comparing new-parser output against old-parser records -- the several
  // hundred phantom drifts the version field exists to prevent.
  //
  // docfacts-refresh does not call readSnapshot (it builds an empty snapshot
  // from scratch), so the remedy this message names stays reachable after a
  // bump. That is what makes the gate safe to place here.
  if (result.data.extractorVersion !== EXTRACTOR_VERSION) {
    throw new Error(
      `${path}: built by extractor v${result.data.extractorVersion}, but this build is v${EXTRACTOR_VERSION}. ` +
      "Every record would differ for parser reasons rather than doc reasons. " +
      "Run `npm run docfacts:refresh` to re-baseline.",
    );
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
