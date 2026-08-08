import type { Knowledge, Scenario } from "./schema.js";

/**
 * Scenario lookup by id, indexed once per knowledge pack.
 *
 * Six tools used to carry their own `scenarios.find(s => s.id === id)`. Several
 * of them run it inside a map over related ids, so the cost was the pack size
 * times the number of ids looked up. The pack went from 96 scenarios to 210 in
 * one release, which is the kind of growth that turns a harmless scan into a
 * habit worth breaking.
 *
 * The index is held in a WeakMap keyed by the pack itself, so a test that loads
 * its own fixture gets its own index and nothing outlives the pack it describes.
 */
const indexes = new WeakMap<Knowledge, Map<string, Scenario>>();

function indexOf(k: Knowledge): Map<string, Scenario> {
  let index = indexes.get(k);
  if (!index) {
    index = new Map(k.scenarios.map((s) => [s.id, s]));
    indexes.set(k, index);
  }
  return index;
}

/** The scenario with this id, or undefined. */
export function findScenario(k: Knowledge, id: string): Scenario | undefined {
  return indexOf(k).get(id);
}

/** The scenarios for these ids, in order, skipping any that do not resolve. */
export function findScenarios(k: Knowledge, ids: readonly string[]): Scenario[] {
  const index = indexOf(k);
  const out: Scenario[] = [];
  for (const id of ids) {
    const found = index.get(id);
    if (found) out.push(found);
  }
  return out;
}
