# IIIF viewer load: flow and timing

How a Hyku/Hyrax work-show page gets from "browser requests URL" to "IIIF viewer
showing an image," and what each step actually costs. Narrative is general
(applies to any Hyku/Hyrax + Universal Viewer deployment); the timing numbers are
from real captures against `demo.hykuup.com` (image work
`3812ff57-82e2-4d73-8cd8-9617fdfb3c44`), specifically:

- `hykuup/browser/combined_trace.json` / `combined_trace.har` — DOM + network
  events on one timeline (`bin/trace_combined.py`), the source for the timing
  table in §4
- `hykuup/browser/demo_hykuup_image_show.har`, `staging_trace.har` — additional
  single-run HAR captures, used for the main-document timing comparison in §5
- `ethos-bl-uk/browser/*` — a second deployment/work-type, used as a contrast
  case in §7

Timings are from single runs and vary noticeably between captures (see §5) — read
them as "roughly this shape," not as SLA numbers. The
[`iiif-perf-tests`](https://github.com/notch8/iiif-perf-tests) repo turns this
investigation into a repeatable suite so this can be tracked over time instead of
re-measured by hand each time.

## 1. Network path

- DNS resolves to Cloudflare's edge.
- Cloudflare serves cached responses directly; a cache-busting `?cache=<ts>` query
  param (used throughout these captures) forces `cf-cache-status: MISS` so it's the
  real backend being timed, not an edge cache hit.
- Everything else forwards to the cluster's AWS load balancer.
- HykuUp-specific (not implemented on every deployment): the ALB hits the Hyku
  app's own nginx reverse proxy running in its namespace, which serves anything in
  the Rails app's public/assets directory itself and forwards everything else to
  Rails (Puma).

## 2. Two distinct IIIF API calls are involved

- **IIIF Presentation API** — `GET /concern/<type>/<id>/manifest` → `manifest.json`.
  Describes the work's structure: canvases, and where to find the images for each.
- **IIIF Image API** — `GET /<identifier>/<region>/<size>/<rotation>/<quality>.<format>`
  (e.g. `.../full/234,/0/default.jpg`), plus an `info.json` describing what
  sizes/features are available for a given image. Universal Viewer requests
  several sizes per canvas concurrently (thumbnail-strip size + a viewing size),
  not just one. All of it — manifest, info.json, and tile bytes — is served through
  the same Rails app as the rest of the page; there's no separate IIIF host in the case of HykuUp.

Deployments don't agree on a URL prefix for the Image API — hykuup serves these
under `/images/<id>/...` with no `iiif` segment in the path at all, despite being a
fully compliant IIIF Image API 2.1/3.0 server (`serverless-iiif`). Worth knowing
before writing anything that pattern-matches these URLs: matching on `/iiif/` will
silently find nothing. (This bit `iiif-perf-tests`' default tile detector during
development — fixed by matching the API's `region/size/rotation/quality.format`
shape instead of assuming a prefix.)

Whether a given tile request is fast or slow depends on the IIIF image server/gem
in play and how it's configured:

- Some (e.g. `riiif`) generate the requested region/size on the fly from the
  source image on each request — cost depends on the source file and what
  processing that specific crop/resize needs, and is invisible from the outside
  until you actually request that region/size combination.
- Responses may or may not be cached at any of several layers (Rails cache, Redis,
  nginx, Cloudflare) — whether a given tile request is a cache hit or a fresh
  render changes its cost by potentially an order of magnitude, and that's
  generally not visible from the response alone without checking cache-status
  headers per layer.

## 3. Why the viewer iframe doesn't appear immediately

Sprockets-era Rails apps typically ship one large, non-code-split JS bundle
(`application-*.js`, ~586KB minified here) rather than the split bundles a modern
webpack/vite setup would produce. The DOM-ready handler that inserts the viewer
`<iframe>` lives inside that bundle, so nothing happens until the whole thing has
been downloaded, parsed, and executed on the main thread — even though the assets
needed to render the rest of the page (CSS, fonts, thumbnails) may have already
arrived. (The thumbnails are for other works shown at the bottom of the page —
they're unrelated to the current viewer, just also part of that same head-section
asset wave, which is why they show up this early despite rendering below the
fold.)

One earlier server-log-correlated capture (see repo `README.md`) found a concrete
~2.6s gap with **zero network activity** between "all head-section assets have
arrived" and "browser finally requests `uv.html`" — that gap is JS parse/execution
time, not network time. In the `combined_trace.json` run tabulated below that gap
is much smaller (tens of ms, not seconds) — plausibly warm V8 bytecode caching or
just run-to-run variance; either way, the mechanism (nothing viewer-related happens
until that bundle finishes executing) is the important, non-obvious part, not the
exact gap size.

## 4. Timing table (one capture, `combined_trace.json`)

t is milliseconds since navigation start.

| t (ms) | Event |
|---:|---|
| 6 | Main document request sent |
| 4,997 | Main document response (200) — **~5.0s**, essentially all backend wait |
| 5,013–5,016 | Head-section requests fire: app CSS bundle, app JS bundle, Google Fonts CSS, Google Tag Manager, logo, 2 file thumbnails |
| 5,177–6,880 | Those responses trickle in (CSS bundle fastest at +164ms; GTM slowest at +1.9s) |
| 6,884 | `uv.html` (viewer iframe document) requested — JS bundle has now finished executing |
| 6,901 | Iframe found in DOM (17ms after the request that created it) |
| 6,904 | `DOMContentLoaded` |
| 6,905 | `turbolinks:load` |
| 6,920 | Cloudflare `challenge-platform` bot-management script requested (see §6 — this runs on *every* load, not just interstitials) |
| 6,922–7,832 | Iframe's own asset wave: `uv.css`, `UV.js` (entry chunk), then 2 more UV JS chunks |
| 7,839 | `iframe:load` and `window:load` (simultaneous) |
| 7,842 | IIIF **manifest** request begins — 7.8s into the page load, well after `window:load` |
| 8,991 | Manifest response (200) — **~1.1s**, mostly backend wait |
| 8,993–9,449 | 6 more UV JS chunks requested/resolved — these appear to be viewer-type-specific modules Universal Viewer loads dynamically once it knows from the manifest what kind of content it's rendering |
| 9,456–9,618 | `uv-config.json` fetched (~162ms) |
| 9,675 | **First IIIF Image API tile request** fires — 9.7s after navigation start |
| 9,717–10,018 | First wave of tile responses: 8 total requests across both file_sets/canvases at several sizes each, all resolving within ~350ms of the first |
| 11,975 / 12,718 | Only remaining traffic: two GA4 beacon round-trips, ~750ms apart — not part of the actual page experience |

Universal Viewer alone makes **10 separate JS requests** (`UV.js` + 9 chunks) with
no bundling — matches the earlier informal observation of "9 javascript files."

## 5. Main-document HAR timing: `dns` / `connect` / `ssl` / `wait` / `receive`

| Capture | dns | connect | ssl | wait | receive |
|---|---:|---:|---:|---:|---:|
| `combined_trace.har` | 2,066ms | 376ms | 358ms | 2,540ms | 3ms |
| `demo_hykuup_image_show.har` | 1,051ms | 132ms | 112ms | 1,612ms | 5ms |
| `staging_trace.har` | n/a (reused connection) | n/a | n/a | 1,569ms | 8ms |
| `iiif-perf-tests` smoke runs (this session) | 3–34ms | 51–71ms | 36–56ms | 1,536–2,140ms | 5ms |

`dns`/`connect`/`ssl` swing wildly between captures — almost certainly local
network/resolver conditions on the machine doing the capturing, not the target
deployment. `wait` (time-to-first-byte from the Rails app) is the one number that's
consistently the dominant, meaningful cost here: **~1.5–2.5s** across every capture,
regardless of which machine or network measured it.
