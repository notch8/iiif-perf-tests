export interface HarTiming {
  dns: number | null;
  connect: number | null;
  ssl: number | null;
  wait: number | null;
  receive: number | null;
}

export interface ConsoleErrorEntry {
  text: string;
  location: string | null;
}

export interface PageErrorEntry {
  message: string;
  stack: string | null;
}

export interface MilestoneStep {
  name: string;
  atMs: number | null; // ms since navigation start; null if never observed
  stepMs: number | null; // ms since the previous *observed* step; null if this step wasn't observed
  url: string | null; // associated URL for request/response-type steps; null otherwise
}

export interface RunMilestones {
  viewerSelector: string;
  networkIdleTimedOut: boolean;
  steps: MilestoneStep[];
  totalMs: number | null; // atMs of the last observed step
  // Count of script-type requests fired strictly after the manifest response
  // and up to (inclusive) the info.json request — the viewer parsing the
  // manifest and fetching more of its own JS chunks before it can act on it.
  // null if either boundary (manifestResponse, infoRequest) wasn't observed.
  jsChunksBetweenManifestAndInfo: number | null;
}

export interface RunMetrics {
  host: string;
  workPath: string;
  url: string;
  runLabel: string | null;
  runStartedAtUtc: string;
  runFinishedAtUtc: string;
  cloudflareChallenge: {
    detected: boolean;
    pageTitle: string | null;
  };
  mainDocument: {
    status: number | null;
    timing: HarTiming | null;
    error: string | null;
  };
  milestones: RunMilestones | null;
  consoleErrors: ConsoleErrorEntry[];
  pageErrors: PageErrorEntry[];
  artifacts: {
    harPath: string;
    screenshotPath: string;
  };
}
