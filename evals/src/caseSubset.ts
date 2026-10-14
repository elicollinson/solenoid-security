/** Deterministic, seeded, label-balanced case subsets for pilot suites (written into EvalTest.caseIds). */
import { sha256 } from "./strategies.js";
import type { EvalCase } from "./types.js";

export interface SubsetSpec {
  testId: string;
  seed: string;
  /** Cases per class. "all" keeps every case of that class; 0 or omitted keeps none. */
  positive?: number | "all";
  negative?: number | "all";
  /** Within a class, take cases round-robin across this facet's values (sorted), so each stratum is covered. */
  stratumFacet?: string;
  /** Sample whole groups sharing this facet (e.g. a benign/attack pair) instead of single cases; requires `groups`. */
  pairFacet?: string;
  groups?: number;
}

/** Rank key: sha256 of seed, test and unit ID. Independent of dataset order and of any model output. */
export function rankKey(seed: string, testId: string, unit: string): string {
  return sha256(`${seed}\u0000${testId}\u0000${unit}`);
}

function facetKey(item: EvalCase, facet: string): string {
  const value = item.facets[facet];
  if (value === undefined || Array.isArray(value)) throw new Error(`Case ${item.id} lacks scalar facet ${facet}`);
  return String(value);
}

function takeClass(cases: readonly EvalCase[], quota: number | "all" | undefined, spec: SubsetSpec): EvalCase[] {
  if (quota === undefined || quota === 0) return [];
  if (quota === "all") return [...cases];
  if (!Number.isSafeInteger(quota) || quota < 0) throw new Error(`Invalid quota for ${spec.testId}`);
  if (quota > cases.length) throw new Error(`${spec.testId}: quota ${quota} exceeds ${cases.length} available cases`);
  const byRank = (a: EvalCase, b: EvalCase) => rankKey(spec.seed, spec.testId, a.id).localeCompare(rankKey(spec.seed, spec.testId, b.id));
  if (!spec.stratumFacet) return [...cases].sort(byRank).slice(0, quota);
  const buckets = new Map<string, EvalCase[]>();
  for (const item of cases) {
    const key = facetKey(item, spec.stratumFacet);
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  const queues = [...buckets.keys()].sort().map(key => buckets.get(key)!.sort(byRank));
  const out: EvalCase[] = [];
  for (let round = 0; out.length < quota; round++) {
    for (const queue of queues) if (round < queue.length && out.length < quota) out.push(queue[round]!);
  }
  return out;
}

/** Returns selected case IDs in dataset order. Throws instead of silently returning fewer cases than requested. */
export function selectSubset(cases: readonly EvalCase[], isPositive: (item: EvalCase) => boolean, spec: SubsetSpec): string[] {
  if (!spec.seed || !spec.testId) throw new Error("Subset needs a seed and test ID");
  let chosen: EvalCase[];
  if (spec.pairFacet) {
    if (!Number.isSafeInteger(spec.groups) || spec.groups! < 1 || spec.positive !== undefined || spec.negative !== undefined || spec.stratumFacet) throw new Error(`${spec.testId}: pair sampling takes only groups`);
    const groups = new Map<string, EvalCase[]>();
    for (const item of cases) {
      const key = facetKey(item, spec.pairFacet);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    if (spec.groups! > groups.size) throw new Error(`${spec.testId}: ${spec.groups} groups exceed ${groups.size}`);
    const keys = [...groups.keys()].sort((a, b) => rankKey(spec.seed, spec.testId, a).localeCompare(rankKey(spec.seed, spec.testId, b))).slice(0, spec.groups);
    chosen = keys.flatMap(key => groups.get(key)!);
  } else {
    chosen = [...takeClass(cases.filter(isPositive), spec.positive, spec), ...takeClass(cases.filter(item => !isPositive(item)), spec.negative, spec)];
  }
  const keep = new Set(chosen.map(item => item.id));
  return cases.filter(item => keep.has(item.id)).map(item => item.id);
}
