import type { Knowledge, PrerequisiteProducer, Scenario } from "./schema.js";
import { findScenario } from "./lookup.js";

export interface PrerequisiteStep {
  order: number;
  scenarioId: string;
  title: string;
  method: string;
  path: string;
  /** The path placeholder this call exists to obtain. */
  provides: string;
  why: string;
}

export interface PrerequisitePlan {
  target: string;
  steps: PrerequisiteStep[];
  /** Placeholders the caller has to supply; nothing in the pack produces them. */
  callerSupplied: string[];
  /** Placeholders with no known producer, which is a gap in the map rather than in the API. */
  unresolved: string[];
}

/** Path placeholders, in the order they appear. Query placeholders included. */
function placeholdersOf(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string);
}

/**
 * Placeholders a caller decides rather than looks up: paging, filtering, market
 * and segment. Listing them keeps them out of `unresolved`, which is reserved
 * for ids the map genuinely fails to explain.
 */
const CALLER_SUPPLIED = new Set([
  "size", "offset", "filter", "url-encoded-json", "country", "country-code", "currency",
  "currency-code", "region", "segment", "targetSegment", "targetView", "start", "end",
  "start-time", "end-time", "language", "market", "month", "date", "period", "term-duration",
  "term-start-date", "billing-cycle-type", "billing-period", "agreement-type", "validation-type",
  "program-name", "tenant-id", "domain", "isocode-id", "granularity", "view", "base-sku-paths",
  "external-reference-id", "groupby-queries", "filter-string", "mpnId", "MpnId", "TenantId",
  "daily|hourly", "true|false", "immediate|scheduled", "current|previous", "Active|Resolved|Investigating",
  "target-segment", "target-view", "startDate", "endDate", "billing-provider",
  "invoice-line-item-type", "resourceType", "relationship-type",
  // A Microsoft Entra group id. Real, but it comes from Graph, and no Partner
  // Center scenario yields one.
  "group-id",
]);

function producerFor(
  producers: readonly PrerequisiteProducer[],
  placeholder: string,
  targetPath: string,
): PrerequisiteProducer | undefined {
  const candidates = producers.filter((p) => p.placeholder === placeholder);
  // A qualified entry wins when its condition matches; otherwise fall back to
  // the unqualified one. `policy-id` means two different things depending on
  // the route it appears in, which is what the condition exists for.
  return (
    candidates.find((p) => p.whenPathContains !== undefined && targetPath.includes(p.whenPathContains)) ??
    candidates.find((p) => p.whenPathContains === undefined)
  );
}

/**
 * The ordered calls needed to obtain a scenario's path parameters.
 *
 * Walks the target's placeholders, resolves each to the scenario that yields
 * it, and recurses into that scenario's own placeholders. The result is
 * dependency-ordered: a producer always appears before whatever needs it.
 *
 * This derives a plan for any scenario in the pack, which is what the curated
 * pc_plan_* workflows cannot do. Those still say more: they encode the business
 * sequence and its guards, not merely how to get an id.
 */
export function planPrerequisites(k: Knowledge, target: Scenario): PrerequisitePlan {
  const steps: PrerequisiteStep[] = [];
  const callerSupplied: string[] = [];
  const unresolved: string[] = [];
  const emitted = new Set<string>();
  const visiting = new Set<string>();

  const resolve = (path: string, chain: string[]): void => {
    for (const placeholder of placeholdersOf(path)) {
      if (CALLER_SUPPLIED.has(placeholder)) {
        if (!callerSupplied.includes(placeholder)) callerSupplied.push(placeholder);
        continue;
      }
      const producer = producerFor(k.prerequisites, placeholder, path);
      if (!producer) {
        if (!unresolved.includes(placeholder)) unresolved.push(placeholder);
        continue;
      }
      // A producer that needs what it produces would loop; report it as caller
      // supplied rather than recursing, because the caller has to break the tie.
      if (visiting.has(producer.producedBy) || producer.producedBy === target.id) {
        if (!callerSupplied.includes(placeholder)) callerSupplied.push(placeholder);
        continue;
      }
      if (emitted.has(producer.producedBy)) continue;

      const scenario = findScenario(k, producer.producedBy);
      if (!scenario) { unresolved.push(placeholder); continue; }

      visiting.add(producer.producedBy);
      resolve(scenario.path, [...chain, producer.producedBy]);
      visiting.delete(producer.producedBy);

      if (emitted.has(producer.producedBy)) continue;
      emitted.add(producer.producedBy);
      steps.push({
        order: steps.length + 1,
        scenarioId: scenario.id,
        title: scenario.title,
        method: scenario.method,
        path: scenario.path,
        provides: placeholder,
        why: producer.note,
      });
    }
  };

  resolve(target.path, [target.id]);
  return { target: target.id, steps, callerSupplied, unresolved };
}
