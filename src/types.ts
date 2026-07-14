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

export interface RunMilestones {
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
  viewerFoundMs: number | null;
  viewerSelector: string;
  viewerSrc: string | null;
  firstTileRequestMs: number | null;
  firstTileResponseMs: number | null;
  firstTileUrl: string | null;
  networkIdleMs: number | null;
  networkIdleTimedOut: boolean;
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
