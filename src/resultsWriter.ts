import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { slugifyWorkPath } from './config';
import type { RunMetrics } from './types';

export interface RunPaths {
  runDir: string;
  jsonPath: string;
  harPath: string;
  screenshotPath: string;
}

/**
 * Lays out results as results/<host>/<work-slug>/[label/]<run-timestamp>/ so
 * runs for the same work (and, when labeled, the same named scenario) sit
 * together and are easy to diff/compare, while different hosts and works
 * never collide. The label segment is omitted entirely when not set, keeping
 * unlabeled runs on the original flat layout.
 */
export function buildRunPaths(
  outputDir: string,
  host: string,
  workPath: string,
  runTimestamp: string,
  runLabel?: string | null
): RunPaths {
  const workDir = path.join(outputDir, host, slugifyWorkPath(workPath), ...(runLabel ? [runLabel] : []));
  const runDir = path.join(workDir, runTimestamp);
  return {
    runDir,
    jsonPath: path.join(workDir, `${runTimestamp}.json`),
    harPath: path.join(runDir, 'trace.har'),
    screenshotPath: path.join(runDir, 'screenshot.png'),
  };
}

export async function ensureRunDirs(paths: RunPaths): Promise<void> {
  await mkdir(paths.runDir, { recursive: true });
}

export async function writeMetrics(paths: RunPaths, metrics: RunMetrics): Promise<void> {
  await writeFile(paths.jsonPath, JSON.stringify(metrics, null, 2), 'utf-8');
}
