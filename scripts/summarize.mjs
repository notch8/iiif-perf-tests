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

function toRow(run) {
  const m = run.metrics;
  return {
    timestamp: m.runStartedAtUtc ?? null,
    host: m.host ?? null,
    workPath: m.workPath ?? null,
    runLabel: m.runLabel ?? null,
    challenge: Boolean(m.cloudflareChallenge?.detected),
    navError: Boolean(m.mainDocument?.error),
    wait: m.mainDocument?.timing?.wait ?? null,
    viewerFoundMs: m.milestones?.viewerFoundMs ?? null,
    firstTileRequestMs: m.milestones?.firstTileRequestMs ?? null,
    networkIdleMs: m.milestones?.networkIdleMs ?? null,
    networkIdleTimedOut: Boolean(m.milestones?.networkIdleTimedOut),
    consoleErrorCount: Array.isArray(m.consoleErrors) ? m.consoleErrors.length : 0,
    pageErrorCount: Array.isArray(m.pageErrors) ? m.pageErrors.length : 0,
  };
}

function fmtMs(value) {
  return value === null || value === undefined ? 'N/A' : `${Math.round(value)}ms`;
}

function fmtNetworkIdle(row) {
  if (row.networkIdleTimedOut) return 'timed out';
  return fmtMs(row.networkIdleMs);
}

// Stats over only the non-null values for one column — a null in one column
// (e.g. a timed-out networkIdle) must not exclude that run from other columns.
function stats(values) {
  const total = values.length;
  const nums = values.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  const n = nums.length;
  if (n === 0) return { min: null, median: null, max: null, n, total };
  const mid = Math.floor(n / 2);
  const median = n % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
  return { min: nums[0], median, max: nums[n - 1], n, total };
}

function fmtStat(s) {
  if (s.n === 0) return `N/A (n=0/${s.total})`;
  return `${fmtMs(s.median)} (${fmtMs(s.min)}–${fmtMs(s.max)}, n=${s.n}/${s.total})`;
}

function groupKey(row) {
  return `${row.host} ${row.workPath} [${row.runLabel ?? 'unlabeled'}]`;
}

function printPerRunTable(rows) {
  const sorted = [...rows].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  console.log('## Per-run\n');
  console.log(
    '| Timestamp | Host | Work | Label | Challenge | Nav error | Wait | Viewer found | First tile | Network idle | Console errs | Page errs |'
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of sorted) {
    console.log(
      `| ${r.timestamp} | ${r.host} | ${r.workPath} | ${r.runLabel ?? '—'} | ${r.challenge ? '⚠️ yes' : 'no'} | ${
        r.navError ? '⚠️ yes' : 'no'
      } | ${fmtMs(r.wait)} | ${fmtMs(r.viewerFoundMs)} | ${fmtMs(r.firstTileRequestMs)} | ${fmtNetworkIdle(r)} | ${
        r.consoleErrorCount
      } | ${r.pageErrorCount} |`
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

  console.log('## Aggregate (median (min–max, n=non-null/total))\n');
  console.log('| Group | Runs | Challenges | Nav errors | Wait | Viewer found | First tile | Network idle |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const [key, groupRows] of groups) {
    const challengeCount = groupRows.filter((r) => r.challenge).length;
    const navErrorCount = groupRows.filter((r) => r.navError).length;
    // Timed-out networkIdle runs are excluded from the numeric stat (there's
    // no finite value to average) but their count is surfaced separately —
    // silently folding them into "missing data" would hide a real signal.
    const idleTimeouts = groupRows.filter((r) => r.networkIdleTimedOut).length;
    const idleStat = stats(groupRows.map((r) => r.networkIdleMs));
    const idleSuffix = idleTimeouts > 0 ? ` (+${idleTimeouts} timed out)` : '';

    console.log(
      `| ${key} | ${groupRows.length} | ${challengeCount > 0 ? `⚠️ ${challengeCount}` : '0'} | ${
        navErrorCount > 0 ? `⚠️ ${navErrorCount}` : '0'
      } | ${fmtStat(stats(groupRows.map((r) => r.wait)))} | ${fmtStat(stats(groupRows.map((r) => r.viewerFoundMs)))} | ${fmtStat(
        stats(groupRows.map((r) => r.firstTileRequestMs))
      )} | ${fmtStat(idleStat)}${idleSuffix} |`
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
