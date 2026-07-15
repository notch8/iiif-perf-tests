import { test } from '@playwright/test';
import { loadConfig } from '../src/config';
import { buildInitScript, extractMilestoneTimes, RawPerfEvent } from '../src/viewerDetection';
import { extractMainDocumentTiming } from '../src/harTiming';
import { buildRunPaths, ensureRunDirs, writeMetrics } from '../src/resultsWriter';
import { buildSteps, type RawStep, type StepName } from '../src/milestoneSteps';
import type { RunMetrics, ConsoleErrorEntry, PageErrorEntry } from '../src/types';

const config = loadConfig();

test.describe.configure({ mode: 'serial' });

// IIIF_TEST_REPEAT lets one invocation gather several samples of the same
// work — single-run timings are noisy (see request_flow.md §5), so comparing
// an infrastructure change before/after needs more than one data point per side.
for (const workPath of config.works) {
  for (let attempt = 1; attempt <= config.repeat; attempt++) {
    const title =
      config.repeat > 1
        ? `IIIF viewer load: ${config.host}${workPath} (${attempt}/${config.repeat})`
        : `IIIF viewer load: ${config.host}${workPath}`;

    test(title, async ({ browser }, testInfo) => {
      test.setTimeout(config.navTimeoutMs + config.networkIdleTimeoutMs + 30000);

      const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const paths = buildRunPaths(config.outputDir, config.host, workPath, runTimestamp, config.runLabel);
      await ensureRunDirs(paths);

      // Cache-bust so Cloudflare serves a real backend response (cf-cache-status:
      // MISS) instead of an edge cache hit — we're measuring backend load time.
      const cachebust = Date.now();
      const url = `https://${config.host}${workPath}?cache=${cachebust}`;

      const context = await browser.newContext({
        userAgent: config.userAgent,
        viewport: { width: config.viewportWidth, height: config.viewportHeight },
        recordHar: { path: paths.harPath, mode: 'full' },
      });
      await context.addInitScript(buildInitScript(config.viewerSelector));

      // Scoped to the target host only — context-wide extraHTTPHeaders would
      // send the (optional) basic-auth Authorization header to every request,
      // including third-party origins (Google Fonts, GTM, Cloudflare Insights).
      if (Object.keys(config.extraHeaders).length > 0) {
        await context.route(`https://${config.host}/**`, async (route) => {
          await route.continue({ headers: { ...route.request().headers(), ...config.extraHeaders } });
        });
      }

      const page = await context.newPage();

      const consoleErrors: ConsoleErrorEntry[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const loc = msg.location();
          consoleErrors.push({
            text: msg.text(),
            location: loc?.url ? `${loc.url}:${loc.lineNumber}` : null,
          });
        }
      });

      const pageErrors: PageErrorEntry[] = [];
      page.on('pageerror', (err) => {
        pageErrors.push({ message: err.message, stack: err.stack ?? null });
      });

      // Network listener timestamps use the Node-side clock; DOM milestones below
      // use the page's performance.now(). Both are anchored to the same goto()
      // call a few lines down, so cross-process clock skew (sub-millisecond in
      // practice, local process) is negligible next to the multi-second timings
      // this suite measures.
      let navStartMs = 0;
      const requestResponseSteps: Array<{ pattern: RegExp; requestStep: StepName; responseStep: StepName }> = [
        { pattern: config.manifestPattern, requestStep: 'manifestRequest', responseStep: 'manifestResponse' },
        { pattern: config.infoPattern, requestStep: 'infoRequest', responseStep: 'infoResponse' },
        { pattern: config.tilePattern, requestStep: 'firstTileRequest', responseStep: 'firstTileResponse' },
      ];
      const firstMatch: Partial<Record<StepName, RawStep>> = {};
      // Every script-type request, timestamped — used below to count how many
      // JS chunks the viewer fetches between getting the manifest and being
      // able to request info.json (its own bootstrapping cost, not backend
      // latency — see README "Metrics JSON shape").
      const scriptRequests: Array<{ atMs: number }> = [];
      page.on('request', (req) => {
        for (const s of requestResponseSteps) {
          if (!firstMatch[s.requestStep] && s.pattern.test(req.url())) {
            firstMatch[s.requestStep] = { atMs: Date.now() - navStartMs, url: req.url() };
          }
        }
        if (req.resourceType() === 'script') {
          scriptRequests.push({ atMs: Date.now() - navStartMs });
        }
      });
      page.on('response', (res) => {
        for (const s of requestResponseSteps) {
          if (!firstMatch[s.responseStep] && s.pattern.test(res.url())) {
            firstMatch[s.responseStep] = { atMs: Date.now() - navStartMs, url: res.url() };
          }
        }
      });

      let navError: string | null = null;
      navStartMs = Date.now();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: config.navTimeoutMs });
      } catch (err) {
        navError = (err as Error).message;
      }

      const pageTitle = await page.title().catch(() => '');
      const cloudflareDetected = /just a moment|attention required/i.test(pageTitle);
      if (cloudflareDetected) {
        // Recorded as an annotation, not a failure: a challenge is a real,
        // measurable outcome we want to track over time, not a broken run.
        testInfo.annotations.push({
          type: 'cloudflare-challenge',
          description: `Detected on ${url} (title: "${pageTitle}")`,
        });
      }

      let networkIdleMs: number | null = null;
      let networkIdleTimedOut = false;
      if (!navError && !cloudflareDetected) {
        try {
          await page.waitForLoadState('networkidle', { timeout: config.networkIdleTimeoutMs });
          networkIdleMs = Date.now() - navStartMs;
        } catch {
          networkIdleTimedOut = true;
        }
      }

      await page.screenshot({ path: paths.screenshotPath, fullPage: true }).catch(() => {});

      const rawEvents = await page
        .evaluate<RawPerfEvent[]>(() => (window as unknown as { __iiifPerfEvents: RawPerfEvent[] }).__iiifPerfEvents || [])
        .catch(() => [] as RawPerfEvent[]);
      const milestoneTimes = extractMilestoneTimes(rawEvents);

      await context.close();

      const mainDocument = await extractMainDocumentTiming(paths.harPath, url);
      if (navError && !mainDocument.error) {
        mainDocument.error = navError;
      }

      const metrics: RunMetrics = {
        host: config.host,
        workPath,
        url,
        runLabel: config.runLabel,
        runStartedAtUtc: new Date(navStartMs).toISOString(),
        runFinishedAtUtc: new Date().toISOString(),
        cloudflareChallenge: { detected: cloudflareDetected, pageTitle: pageTitle || null },
        mainDocument,
        milestones: navError
          ? null
          : (() => {
              const { steps, totalMs } = buildSteps({
                domContentLoaded: { atMs: milestoneTimes.domContentLoadedMs },
                loadEvent: { atMs: milestoneTimes.loadEventMs },
                viewerFound: { atMs: milestoneTimes.viewerFoundMs, url: milestoneTimes.viewerSrc },
                ...firstMatch,
                networkIdle: { atMs: networkIdleMs },
              });

              const manifestResponseAt = firstMatch.manifestResponse?.atMs;
              const infoRequestAt = firstMatch.infoRequest?.atMs;
              const jsChunksBetweenManifestAndInfo =
                manifestResponseAt != null && infoRequestAt != null
                  ? scriptRequests.filter((r) => r.atMs > manifestResponseAt && r.atMs <= infoRequestAt).length
                  : null;

              return {
                viewerSelector: config.viewerSelector,
                networkIdleTimedOut,
                steps,
                totalMs,
                jsChunksBetweenManifestAndInfo,
              };
            })(),
        consoleErrors,
        pageErrors,
        artifacts: {
          harPath: paths.harPath,
          screenshotPath: paths.screenshotPath,
        },
      };

      await writeMetrics(paths, metrics);

      await testInfo.attach('metrics.json', { path: paths.jsonPath, contentType: 'application/json' });
      await testInfo.attach('screenshot.png', { path: paths.screenshotPath, contentType: 'image/png' }).catch(() => {});
      await testInfo.attach('trace.har', { path: paths.harPath, contentType: 'application/json' }).catch(() => {});

      // A genuine navigation failure (DNS, timeout, connection refused) is a real
      // infrastructure problem, unlike timing variance — surface it as a failure.
      if (navError) {
        throw new Error(`Navigation failed for ${url}: ${navError}`);
      }
    });
  }
}
