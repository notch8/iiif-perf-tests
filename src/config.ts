// Plain, unremarkable desktop Chrome UA. Deliberately NOT any special bypass
// string — this repo is public, so anything that lets traffic skip WAF/bot
// checks must never be hardcoded or documented here. Set a real override
// locally via IIIF_TEST_UA (e.g. in a gitignored .env) if your deployment
// needs one; see README's "User-Agent" section.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Matches the IIIF Image API 2.x/3.x request shape:
// <identifier>/<region>/<size>/<rotation>/<quality>.<format>
// Deliberately doesn't require a literal "/iiif/" path prefix — different
// Hyku/Hyrax deployments route image requests under different paths
// (e.g. hykuup serves tiles under /images/<id>/... with no "iiif" segment
// at all), so we match on the API's positional shape instead.
// A bare "iframe" selector is too broad in practice: Cloudflare's own bot/JS
// challenge machinery can inject a transient hidden iframe on ordinary
// (non-challenge) page loads, which would be mistaken for the viewer. Default
// to matching known viewer src conventions; override via IIIF_TEST_VIEWER_SELECTOR
// for viewers not covered here (e.g. a div-based OpenSeadragon embed).
const DEFAULT_VIEWER_SELECTOR =
  'iframe[src*="/uv/"], iframe[src*="uv.html"], iframe[src*="mirador"], iframe[src*="universal-viewer"]';

const DEFAULT_TILE_PATTERN =
  '/[^/]+/(full|square|pct:[\\d.,]+|\\d+,\\d+,\\d+,\\d+)/(full|max|\\^?\\d*,\\d*|pct:[\\d.]+)/!?\\d+/(default|color|gray|bitonal)\\.(jpg|jpeg|png|gif|webp|tif|tiff)(\\?|$)';

// IIIF Presentation API manifest, e.g. .../concern/images/<id>/manifest —
// no fixed prefix across deployments, so match on the path suffix instead.
const DEFAULT_MANIFEST_PATTERN = '/manifest(\\.json)?(\\?|$)';

// IIIF Image API info.json, e.g. .../<identifier>/info.json
const DEFAULT_INFO_PATTERN = '/info\\.json(\\?|$)';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable ${name}. See README.md for setup.`
    );
  }
  return value.trim();
}

function parseWorks(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith('/') ? s : `/${s}`));
}

export interface SuiteConfig {
  host: string;
  works: string[];
  navTimeoutMs: number;
  networkIdleTimeoutMs: number;
  outputDir: string;
  userAgent: string;
  viewerSelector: string;
  tilePattern: RegExp;
  manifestPattern: RegExp;
  infoPattern: RegExp;
  viewportWidth: number;
  viewportHeight: number;
  runLabel: string | null;
  repeat: number;
}

export function loadConfig(): SuiteConfig {
  const host = requireEnv('IIIF_TEST_HOST').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const works = parseWorks(requireEnv('IIIF_TEST_WORKS'));
  const runLabel = process.env.IIIF_TEST_RUN_LABEL?.trim() || null;

  return {
    host,
    works,
    navTimeoutMs: Number(process.env.IIIF_TEST_NAV_TIMEOUT_MS) || 60000,
    networkIdleTimeoutMs: Number(process.env.IIIF_TEST_NETWORKIDLE_TIMEOUT_MS) || 45000,
    outputDir: process.env.IIIF_TEST_OUTPUT_DIR || 'results',
    userAgent: process.env.IIIF_TEST_UA || DEFAULT_USER_AGENT,
    viewerSelector: process.env.IIIF_TEST_VIEWER_SELECTOR || DEFAULT_VIEWER_SELECTOR,
    tilePattern: new RegExp(process.env.IIIF_TEST_TILE_PATTERN || DEFAULT_TILE_PATTERN, 'i'),
    manifestPattern: new RegExp(process.env.IIIF_TEST_MANIFEST_PATTERN || DEFAULT_MANIFEST_PATTERN, 'i'),
    infoPattern: new RegExp(process.env.IIIF_TEST_INFO_PATTERN || DEFAULT_INFO_PATTERN, 'i'),
    viewportWidth: Number(process.env.IIIF_TEST_VIEWPORT_WIDTH) || 1400,
    viewportHeight: Number(process.env.IIIF_TEST_VIEWPORT_HEIGHT) || 1000,
    runLabel,
    repeat: Number(process.env.IIIF_TEST_REPEAT) || 1,
  };
}

export function slugifyWorkPath(workPath: string): string {
  return workPath.replace(/^\//, '').replace(/\//g, '_');
}
