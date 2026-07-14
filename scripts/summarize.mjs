#!/usr/bin/env node
// Aggregates iiif-perf-tests metrics JSON files into a Markdown timing table,
// so successive captures can answer "did this change help?" instead of only
// showing one point-in-time run. See README.md "Comparing runs over time".
//
// Usage: node scripts/summarize.mjs <results-dir> [--label <label>]

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const labelIndex = args.indexOf('--label');
  const label = labelIndex !== -1 ? args[labelIndex + 1] : null;
  return { root: positional[0] ?? 'results', label };
}

function findMetricsFiles(root) {
  let entries;
  try {
    entries = readdirSync(root, { recursive: true, withFileTypes: true });
  } catch (err) {
    throw new Error(`Could not read results directory "${root}": ${err.message}`);
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => path.join(e.parentPath ?? e.path ?? root, e.name));
}

function loadRuns(files) {
  const runs = [];
  for (const file of files) {
    try {
      const metrics = JSON.parse(readFileSync(file, 'utf-8'));
      runs.push({ file, metrics });
    } catch (err) {
      console.error(`Skipping ${file}: ${err.message}`);
    }
  }
  return runs;
}

// Milestones are stored as an ordered "steps" array (see src/milestoneSteps.ts)
// rather than flat named fields, so every named milestone is looked up the
// same way regardless of whether it's a DOM event or a request/response pair.
function stepAtMs(milestones, name) {
  return milestones?.steps?.find((s) => s.name === name)?.atMs ?? null;
}

// Metrics columns pulled out of the steps array for both the per-run and
// aggregate tables — kept in one place so the two stay in sync. Most are
// millisecond timings (fmtMs); jsChunksBetweenManifestAndInfo is a plain
// count (fmtCount), not a duration.
const METRIC_COLUMNS = [
  { key: 'wait', label: 'Wait', get: (m) => m.mainDocument?.timing?.wait ?? null, fmt: fmtMs },
  { key: 'viewerFoundMs', label: 'Viewer found', get: (m) => stepAtMs(m.milestones, 'viewerFound'), fmt: fmtMs },
  { key: 'manifestRequestMs', label: 'Manifest req', get: (m) => stepAtMs(m.milestones, 'manifestRequest'), fmt: fmtMs },
  { key: 'manifestResponseMs', label: 'Manifest resp', get: (m) => stepAtMs(m.milestones, 'manifestResponse'), fmt: fmtMs },
  {
    key: 'jsChunksBetweenManifestAndInfo',
    label: 'JS chunks (manifest→info)',
    get: (m) => m.milestones?.jsChunksBetweenManifestAndInfo ?? null,
    fmt: fmtCount,
  },
  { key: 'infoRequestMs', label: 'Info req', get: (m) => stepAtMs(m.milestones, 'infoRequest'), fmt: fmtMs },
  { key: 'infoResponseMs', label: 'Info resp', get: (m) => stepAtMs(m.milestones, 'infoResponse'), fmt: fmtMs },
  { key: 'firstTileRequestMs', label: 'First tile req', get: (m) => stepAtMs(m.milestones, 'firstTileRequest'), fmt: fmtMs },
  { key: 'firstTileResponseMs', label: 'First tile resp', get: (m) => stepAtMs(m.milestones, 'firstTileResponse'), fmt: fmtMs },
];

function toRow(run) {
  const m = run.metrics;
  const row = {
    timestamp: m.runStartedAtUtc ?? null,
    host: m.host ?? null,
    workPath: m.workPath ?? null,
    runLabel: m.runLabel ?? null,
    challenge: Boolean(m.cloudflareChallenge?.detected),
    navError: Boolean(m.mainDocument?.error),
    networkIdleMs: stepAtMs(m.milestones, 'networkIdle'),
    networkIdleTimedOut: Boolean(m.milestones?.networkIdleTimedOut),
    totalMs: m.milestones?.totalMs ?? null,
    consoleErrorCount: Array.isArray(m.consoleErrors) ? m.consoleErrors.length : 0,
    pageErrorCount: Array.isArray(m.pageErrors) ? m.pageErrors.length : 0,
  };
  for (const col of METRIC_COLUMNS) {
    row[col.key] = col.get(m);
  }
  return row;
}

function fmtMs(value) {
  return value === null || value === undefined ? 'N/A' : `${Math.round(value)}ms`;
}

function fmtCount(value) {
  return value === null || value === undefined ? 'N/A' : `${value}`;
}

function fmtNetworkIdle(row) {
  if (row.networkIdleTimedOut) return 'timed out';
  return fmtMs(row.networkIdleMs);
}

// Stats over only the non-null values for one column — a null in one column
// (e.g. a timed-out networkIdle, or a deployment with no info.json request)
// must not exclude that run from other columns.
function stats(values) {
  const total = values.length;
  const nums = values.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  const n = nums.length;
  if (n === 0) return { min: null, median: null, max: null, n, total };
  const mid = Math.floor(n / 2);
  const median = n % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
  return { min: nums[0], median, max: nums[n - 1], n, total };
}

function fmtStat(s, fmt = fmtMs) {
  if (s.n === 0) return `N/A (n=0/${s.total})`;
  return `${fmt(s.median)} (${fmt(s.min)}–${fmt(s.max)}, n=${s.n}/${s.total})`;
}

function groupKey(row) {
  return `${row.host} ${row.workPath} [${row.runLabel ?? 'unlabeled'}]`;
}

function printPerRunTable(rows) {
  const sorted = [...rows].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const metricLabels = METRIC_COLUMNS.map((c) => c.label);
  console.log('## Per-run\n');
  console.log(
    `| Timestamp | Host | Work | Label | Challenge | Nav error | ${metricLabels.join(' | ')} | Network idle | Total | Console errs | Page errs |`
  );
  console.log(`|${'---|'.repeat(6 + METRIC_COLUMNS.length + 4)}`);
  for (const r of sorted) {
    const metricCells = METRIC_COLUMNS.map((c) => c.fmt(r[c.key])).join(' | ');
    console.log(
      `| ${r.timestamp} | ${r.host} | ${r.workPath} | ${r.runLabel ?? '—'} | ${r.challenge ? '⚠️ yes' : 'no'} | ${
        r.navError ? '⚠️ yes' : 'no'
      } | ${metricCells} | ${fmtNetworkIdle(r)} | ${fmtMs(r.totalMs)} | ${r.consoleErrorCount} | ${r.pageErrorCount} |`
    );
  }
  console.log('');
}

function printAggregateTable(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = groupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const metricLabels = METRIC_COLUMNS.map((c) => c.label);
  console.log('## Aggregate (median (min–max, n=non-null/total))\n');
  console.log(`| Group | Runs | Challenges | Nav errors | ${metricLabels.join(' | ')} | Network idle | Total |`);
  console.log(`|${'---|'.repeat(4 + METRIC_COLUMNS.length + 2)}`);
  for (const [key, groupRows] of groups) {
    const challengeCount = groupRows.filter((r) => r.challenge).length;
    const navErrorCount = groupRows.filter((r) => r.navError).length;
    // Timed-out networkIdle runs are excluded from the numeric stat (there's
    // no finite value to average) but their count is surfaced separately —
    // silently folding them into "missing data" would hide a real signal.
    const idleTimeouts = groupRows.filter((r) => r.networkIdleTimedOut).length;
    const idleStat = stats(groupRows.map((r) => r.networkIdleMs));
    const idleSuffix = idleTimeouts > 0 ? ` (+${idleTimeouts} timed out)` : '';
    const metricCells = METRIC_COLUMNS.map((c) => fmtStat(stats(groupRows.map((r) => r[c.key])), c.fmt)).join(' | ');

    console.log(
      `| ${key} | ${groupRows.length} | ${challengeCount > 0 ? `⚠️ ${challengeCount}` : '0'} | ${
        navErrorCount > 0 ? `⚠️ ${navErrorCount}` : '0'
      } | ${metricCells} | ${fmtStat(idleStat)}${idleSuffix} | ${fmtStat(stats(groupRows.map((r) => r.totalMs)))} |`
    );
  }
  console.log('');
}

function main() {
  const { root, label } = parseArgs(process.argv);
  const files = findMetricsFiles(root);
  if (files.length === 0) {
    console.error(`No metrics JSON files found under "${root}".`);
    process.exit(1);
  }

  let rows = loadRuns(files).map(toRow);
  if (label) {
    rows = rows.filter((r) => r.runLabel === label);
  }
  if (rows.length === 0) {
    console.error(`Found ${files.length} JSON file(s) under "${root}", but none matched label "${label}".`);
    process.exit(1);
  }

  console.log(`# iiif-perf-tests summary\n`);
  console.log(`Source: \`${root}\`${label ? ` (label: \`${label}\`)` : ''} — ${rows.length} run(s)\n`);
  printPerRunTable(rows);
  printAggregateTable(rows);
}

main();
