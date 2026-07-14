import { readFile } from 'fs/promises';
import type { HarTiming } from './types';

interface HarEntry {
  startedDateTime: string;
  request: { url: string; method: string };
  response: { status: number; content?: { mimeType?: string } };
  timings: {
    dns?: number;
    connect?: number;
    ssl?: number;
    send?: number;
    wait?: number;
    receive?: number;
  };
}

function normalize(value: number | undefined): number | null {
  if (value === undefined || value === null || value < 0) return null;
  return value;
}

// HAR "connect" includes TCP connect + TLS handshake time when ssl is a subset
// of it; we report ssl separately and leave connect as the raw HAR connect value.
function extractTiming(entry: HarEntry): HarTiming {
  const t = entry.timings;
  return {
    dns: normalize(t.dns),
    connect: normalize(t.connect),
    ssl: normalize(t.ssl),
    wait: normalize(t.wait),
    receive: normalize(t.receive),
  };
}

/**
 * Reads a Playwright-recorded HAR file and returns the dns/connect/ssl/wait/receive
 * timing breakdown for the main document request (the navigation to `pageUrl`).
 */
export async function extractMainDocumentTiming(
  harPath: string,
  pageUrl: string
): Promise<{ status: number | null; timing: HarTiming | null; error: string | null }> {
  let raw: string;
  try {
    raw = await readFile(harPath, 'utf-8');
  } catch (err) {
    return { status: null, timing: null, error: `Could not read HAR file: ${(err as Error).message}` };
  }

  let har: { log: { entries: HarEntry[] } };
  try {
    har = JSON.parse(raw);
  } catch (err) {
    return { status: null, timing: null, error: `Could not parse HAR file: ${(err as Error).message}` };
  }

  const entries = har.log?.entries ?? [];
  if (entries.length === 0) {
    return { status: null, timing: null, error: 'HAR file has no entries' };
  }

  const targetOrigin = new URL(pageUrl).origin;
  const targetPath = new URL(pageUrl).pathname;

  const match =
    entries.find((e) => {
      try {
        const u = new URL(e.request.url);
        return (
          u.origin === targetOrigin &&
          u.pathname === targetPath &&
          (e.response.content?.mimeType ?? '').includes('html')
        );
      } catch {
        return false;
      }
    }) ?? entries[0];

  return {
    status: match.response?.status ?? null,
    timing: extractTiming(match),
    error: null,
  };
}
