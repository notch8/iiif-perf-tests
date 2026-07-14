import type { MilestoneStep } from './types';

// Canonical, human-readable order of everything this suite times. The actual
// stepMs (duration since the previous *observed* step) is computed from real
// chronological order below, not this list — this only controls display
// order and gives a fixed set of names to look up in downstream tooling
// (e.g. scripts/summarize.mjs), regardless of which steps a given run
// actually observed.
export const CANONICAL_STEP_NAMES = [
  'domContentLoaded',
  'loadEvent',
  'viewerFound',
  'manifestRequest',
  'manifestResponse',
  'infoRequest',
  'infoResponse',
  'firstTileRequest',
  'firstTileResponse',
  'networkIdle',
] as const;

export type StepName = (typeof CANONICAL_STEP_NAMES)[number];

export type RawStep = { atMs: number | null; url?: string | null };

/**
 * Turns a bag of independently-collected milestone timestamps (ms since
 * navigation start) into an ordered "steps" list, each with the time since
 * the previous *observed* step (stepMs) — a waterfall-style breakdown of
 * where the page-load time actually went — plus a totalMs spanning
 * navigation start to the last observed step.
 *
 * Steps are ordered by their real observed atMs, not by CANONICAL_STEP_NAMES
 * — a deployment that (say) requests info.json before the manifest response
 * comes back would still get a correct chronological breakdown.
 */
export function buildSteps(raw: Partial<Record<StepName, RawStep>>): {
  steps: MilestoneStep[];
  totalMs: number | null;
} {
  const observed = CANONICAL_STEP_NAMES
    .map((name) => ({ name, ...raw[name] }))
    .filter((s): s is { name: StepName; atMs: number; url?: string | null } => s.atMs !== null && s.atMs !== undefined)
    .sort((a, b) => a.atMs - b.atMs);

  const stepMsByName = new Map<StepName, number>();
  let previousAtMs = 0;
  for (const s of observed) {
    stepMsByName.set(s.name, s.atMs - previousAtMs);
    previousAtMs = s.atMs;
  }

  const steps: MilestoneStep[] = CANONICAL_STEP_NAMES.map((name) => ({
    name,
    atMs: raw[name]?.atMs ?? null,
    stepMs: stepMsByName.get(name) ?? null,
    url: raw[name]?.url ?? null,
  }));

  const totalMs = observed.length > 0 ? observed[observed.length - 1].atMs : null;

  return { steps, totalMs };
}
