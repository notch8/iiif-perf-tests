/**
 * Injected into the page before navigation. Records performance.now()-relative
 * timestamps for DOM lifecycle events and polls for the viewer embed (an iframe
 * by default, but configurable since different Hyku/Hyrax viewers — Universal
 * Viewer, Mirador, OpenSeadragon — mount differently) so we can time when it
 * appears in the DOM regardless of which JS bundle is responsible for inserting it.
 */
export function buildInitScript(viewerSelector: string): string {
  // Selector is embedded in a single-quoted JS string literal inside the
  // injected script below, so single quotes/backticks/backslashes could break
  // out of that context; double quotes are fine (and needed for attribute
  // selectors like iframe[src*="uv.html"]).
  if (/['`\\]/.test(viewerSelector)) {
    throw new Error(`Invalid viewer selector (must not contain single quotes/backticks/backslashes): ${viewerSelector}`);
  }

  return `
    (() => {
      window.__iiifPerfEvents = [];
      const log = (name, extra) => {
        window.__iiifPerfEvents.push({ name, t: performance.now(), extra: extra || null });
      };
      document.addEventListener('DOMContentLoaded', () => log('domContentLoaded'), true);
      window.addEventListener('load', () => log('load'), true);
      const selector = '${viewerSelector}';
      const check = setInterval(() => {
        const el = document.querySelector(selector);
        if (el && !el.__iiifPerfTraced) {
          el.__iiifPerfTraced = true;
          const src = el.getAttribute && (el.getAttribute('src') || el.getAttribute('data-src'));
          log('viewerFound', src || null);
          clearInterval(check);
        }
      }, 10);
      // Stop polling after 90s so it doesn't run forever if the viewer never appears.
      setTimeout(() => clearInterval(check), 90000);
    })();
  `;
}

export interface RawPerfEvent {
  name: string;
  t: number;
  extra: string | null;
}

export function extractMilestoneTimes(events: RawPerfEvent[]) {
  const domContentLoaded = events.find((e) => e.name === 'domContentLoaded');
  const load = events.find((e) => e.name === 'load');
  const viewerFound = events.find((e) => e.name === 'viewerFound');
  return {
    domContentLoadedMs: domContentLoaded ? domContentLoaded.t : null,
    loadEventMs: load ? load.t : null,
    viewerFoundMs: viewerFound ? viewerFound.t : null,
    viewerSrc: viewerFound ? viewerFound.extra : null,
  };
}
