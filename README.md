# iiif-perf-tests

A repeatable [Playwright](https://playwright.dev/) test suite that measures IIIF-viewer
load performance on a Hyku/Hyrax work-show page, for one or more works on a given host.

It doesn't assert against fixed thresholds — run-to-run variance on real infrastructure
is high — instead it records structured metrics per run so results can be diffed over
time, across works, or across hosts/deployments (hykuup, ethos, etc).

## What it measures, per work

- Whether the page loaded cleanly or hit a Cloudflare challenge/interstitial
  (detected via page title, e.g. "Just a moment..." / "Attention Required") — recorded,
  not treated as a hard failure, and never attempted to be solved.
- HAR `dns` / `connect` / `ssl` / `wait` / `receive` timing breakdown for the main
  document request.
- An ordered, chronological breakdown of every milestone from navigation start
  through `networkidle`: DOM lifecycle events, the viewer embed appearing in the
  DOM, the IIIF **manifest** request/response, the IIIF **info.json**
  request/response, and the first image-tile request/response — each with both
  its absolute time since navigation start and its own step duration (time since
  the previous milestone), plus a total. See "Metrics JSON shape" below.
- `networkidle` timing, or a timed-out marker if the page never settles.
- Console errors and uncaught page errors.
- A screenshot and a HAR file.

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
IIIF_TEST_HOST=demo.hykuup.com \
IIIF_TEST_WORKS=/concern/images/3812ff57-82e2-4d73-8cd8-9617fdfb3c44,/concern/generic_works/67cef51b-fe3d-4703-9dfd-aa967d231898 \
npx playwright test
```

One test runs per entry in `IIIF_TEST_WORKS`, serially (not in parallel — these are
load-time measurements, so concurrent runs would skew each other's timing).

If you need the internal monitoring `IIIF_TEST_UA` value (see below), copy
`.env.example` to `.env` and run through [1Password CLI](https://developer.1password.com/docs/cli/)
instead, which resolves the `op://` reference to the real secret at run time without
ever writing it to disk or your shell history:

```bash
cp .env.example .env   # already gitignored
op run --env-file=.env -- npx playwright test
```

### Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `IIIF_TEST_HOST` | yes | — | Bare host, e.g. `demo.hykuup.com` (scheme/trailing slash stripped if present) |
| `IIIF_TEST_WORKS` | yes | — | Comma-separated **full paths**, e.g. `/concern/images/<id>,/concern/generic_works/<id>`. Full paths are required (not just IDs) because different Hyku/Hyrax deployments use different controller conventions per work type (`images`, `generic_works`, `thesis_or_dissertations`, ...) |
| `IIIF_TEST_NAV_TIMEOUT_MS` | no | `60000` | Timeout for the initial navigation |
| `IIIF_TEST_NETWORKIDLE_TIMEOUT_MS` | no | `45000` | Timeout waiting for `networkidle` after navigation completes |
| `IIIF_TEST_OUTPUT_DIR` | no | `results` | Where JSON/HAR/screenshot artifacts are written |
| `IIIF_TEST_UA` | no | plain desktop Chrome UA | Override the User-Agent sent (see below) |
| `IIIF_TEST_VIEWER_SELECTOR` | no | see `src/config.ts` | CSS selector for the viewer embed. Default matches common Universal Viewer/Mirador iframe `src` conventions. **Tune this per deployment** — see caveat below |
| `IIIF_TEST_TILE_PATTERN` | no | see `src/config.ts` | Regex (as a string) matching an IIIF Image API tile request URL by its `region/size/rotation/quality.format` shape, without assuming any particular URL prefix |
| `IIIF_TEST_MANIFEST_PATTERN` | no | see `src/config.ts` | Regex matching the IIIF Presentation API manifest request URL. Default matches a path ending in `/manifest` or `/manifest.json` |
| `IIIF_TEST_INFO_PATTERN` | no | see `src/config.ts` | Regex matching the IIIF Image API `info.json` request URL. Default matches a path ending in `/info.json` |
| `IIIF_TEST_VIEWPORT_WIDTH` / `IIIF_TEST_VIEWPORT_HEIGHT` | no | `1400` / `1000` | Browser viewport size |
| `IIIF_TEST_RUN_LABEL` | no | none | Tags this batch of runs (e.g. `baseline`, `after-cdn-change`) — stamped into each run's JSON and used as an extra results path segment, so runs for the same scenario group together. See "Comparing runs over time" below |
| `IIIF_TEST_REPEAT` | no | `1` | Run each work this many times in one invocation. Single-run timings are noisy (see `iiif_viewer_investigation/request_flow.md` §5) — a real before/after comparison needs several samples per side, not one |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PW` | no | none | Optional HTTP Basic Auth credentials, for staging/pre-launch deployments that sit behind basic auth just to keep crawlers out. Both must be set for auth to activate — see "Basic auth" below |

### Why a cache-busting query param

Every request URL gets a `?cache=<timestamp>` suffix, which forces Cloudflare to serve
`cf-cache-status: MISS` — otherwise you'd be timing a cached edge response, not real
backend load performance.

### User-Agent

The default `IIIF_TEST_UA` is a plain, unremarkable desktop Chrome string — nothing
that skips bot/WAF checks. This repo is **public**, so no such value is hardcoded or
documented here, on purpose.

Some monitored deployments have an existing, legitimate allowance for a specific
monitoring User-Agent. That value lives in 1Password (`DevOps` vault, item
`iiif-perf-tests monitoring UA`, `credential` field) — never in this repo, in
committed `.env` files, in shell history, or in CI logs. Reference it via `op://`
(see `.env.example`) and run through `op run --env-file=.env -- ...` as shown above;
`op run` also redacts the resolved value from anything the command prints to stdout.
Without it, expect the suite to hit Cloudflare challenges on some deployments, which
it will detect and record rather than try to solve.

### Basic auth

Some staging/pre-launch deployments sit behind HTTP Basic Auth, just to keep
crawlers out — not a real security boundary, but still real credentials. Set
both `BASIC_AUTH_USER` and `BASIC_AUTH_PW` to enable it; leaving either unset
runs the suite with no `Authorization` header at all, same as today. The header
is only ever sent to `IIIF_TEST_HOST` itself (via a scoped `context.route()`,
not a context-wide `extraHTTPHeaders`) — it never reaches third-party requests
the page happens to make (Google Fonts, GTM, Cloudflare Insights, etc.).

Like the monitoring UA, never hardcode real credentials in `k8s/job.yaml` or
any committed file — this repo is public. Reference them via 1Password/`op://`
locally (`.env.example`) or `k8s/external-secret-basic-auth.yaml` in the
cluster, same pattern as `IIIF_TEST_UA`.

## Known caveat: viewer selector false positives

A bare `iframe` selector is too broad in practice — Cloudflare's own bot/JS-challenge
machinery can inject a transient hidden iframe on ordinary (non-challenge) page loads,
which gets mistaken for the viewer appearing. The default selector
(`src/config.ts` → `DEFAULT_VIEWER_SELECTOR`) constrains to known viewer `src`
conventions (Universal Viewer, Mirador) to avoid this. If a deployment uses a
different viewer (e.g. a `<div>`-based OpenSeadragon embed with no iframe at all),
set `IIIF_TEST_VIEWER_SELECTOR` to something that actually matches it, and verify with
a real run — a mismatched selector silently reports `viewerFoundMs: null` rather than
erroring.

## Output layout

```
results/<host>/<work-slug>/[label/]<run-timestamp>.json      # structured metrics for that run
results/<host>/<work-slug>/[label/]<run-timestamp>/trace.har
results/<host>/<work-slug>/[label/]<run-timestamp>/screenshot.png
```

Grouping by work (and, when set, by `IIIF_TEST_RUN_LABEL`) keeps a history of runs
together (sorted by timestamp) for easy diffing over time, while staying disjoint
across hosts, works, and labeled scenarios. The label segment is omitted entirely
when `IIIF_TEST_RUN_LABEL` isn't set.

`results/` is gitignored by default — treat it as run output, not something to commit.
See "Comparing runs over time" below for what *does* get committed.

Playwright's own HTML report (`npx playwright show-report`) also gets the JSON/HAR/
screenshot attached per test, plus a `cloudflare-challenge` annotation on any run where
one was detected.

## Comparing runs over time

Single-run timings are noisy — `iiif_viewer_investigation/request_flow.md` §5 shows
`dns`/`connect`/`ssl` swinging by 20x between captures on the same target, almost
certainly from local network/resolver conditions rather than the deployment itself.
Answering "did this infrastructure change actually help?" needs several samples on
each side of the change, aggregated, not two single runs eyeballed side by side.

1. Run a batch of samples under a label, e.g.:
   ```bash
   IIIF_TEST_HOST=demo.hykuup.com \
   IIIF_TEST_WORKS=/concern/images/3812ff57-82e2-4d73-8cd8-9617fdfb3c44 \
   IIIF_TEST_RUN_LABEL=baseline \
   IIIF_TEST_REPEAT=5 \
   npx playwright test
   ```
2. Summarize that batch into a Markdown timing table:
   ```bash
   node scripts/summarize.mjs results --label baseline
   ```
   This prints a per-run table plus an aggregate table (min/median/max per
   milestone, with sample size — a column computed from 2 of 5 runs is called
   out, not silently blended with the rest). Cloudflare-challenge and
   navigation-error runs are flagged rather than folded in as ordinary missing
   data.
3. Repeat for the "after" scenario with a different label (e.g. `after-cdn-change`),
   then compare the two aggregate tables.
4. To keep a comparison as durable history (mirroring
   [`solr_load_testing`](https://github.com/notch8/solr_load_testing)'s
   `prod_results/` convention), commit a snapshot:
   ```bash
   mkdir -p prod_results/baseline
   node scripts/summarize.mjs results --label baseline > prod_results/baseline/summary.md
   cp results/<host>/<work-slug>/baseline/<a-representative-timestamp>/screenshot.png \
      prod_results/baseline/
   ```
   Then hand-write a short `prod_results/baseline/README.md` noting what was
   tested and any key takeaways (see `solr_load_testing`'s `prod_results/*/README.md`
   for the style). **Never commit a `.har` file to `prod_results/`** — HARs
   capture every response header on the page, including cookies/auth headers,
   and this is a public repo. The per-run JSON metrics files are safe to commit
   (no headers, just timings/URLs) and are the more useful artifact for
   re-analysis anyway.

## Running via Kubernetes

Running from a laptop means the reported `dns`/`connect`/`ssl` numbers are partly
measuring your own network, not the deployment (see above). Running from inside a
cluster — or at least from a fixed, stable location — removes that variable. This
mirrors [`solr_load_testing`](https://github.com/notch8/solr_load_testing)'s
approach for the same reason.

### Prerequisites

- `kubectl` configured with access to the target cluster
- Docker, to build/push the image (or use the one built by CI — see
  `.github/workflows/build-image.yml`)

### Configuration

Edit `IIIF_TEST_HOST`, `IIIF_TEST_WORKS`, and `IIIF_TEST_RUN_LABEL` directly in
`k8s/job.yaml` before each run — these are the values likely to change between
runs, same idea as `solr_load_testing`'s `solr_core` callout. `IIIF_TEST_REPEAT`
(default `5`) controls how many samples get collected per work in that run.

The `ExternalSecret` (`k8s/external-secret.yaml`) requires the target cluster to
already have the `onepassword` `ClusterSecretStore` installed (shared ops infra,
not something this repo provisions) — it fails loudly, not silently, if that's
missing.

### Running a test

```bash
kubectl apply -k . --context <your-cluster>
```

### Retrieving results

Once the Job completes (it sleeps for an hour afterward to leave time for this):

```bash
RESULTS_POD=$(kubectl get pods -n iiif-perf-testing --context <your-cluster> -l job-name=iiif-perf-test -o jsonpath='{.items[0].metadata.name}')
kubectl cp --context <your-cluster> -n iiif-perf-testing ${RESULTS_POD}:/results ./results
```

Then run `node scripts/summarize.mjs results --label <label>` locally as usual.

### Re-running a test

Kubernetes Jobs are immutable once created. If you want to re-run without
changing anything:

```bash
kubectl get job iiif-perf-test -n iiif-perf-testing --context <your-cluster> -o yaml \
  | kubectl replace --force -f -
```

If you changed `job.yaml`, delete first:

```bash
kubectl delete job iiif-perf-test -n iiif-perf-testing --context <your-cluster>
kubectl apply -k . --context <your-cluster>
```

## Metrics JSON shape

See `src/types.ts` (`RunMetrics`) for the exact shape. `milestones.steps` (see
`src/milestoneSteps.ts`) is an array of every milestone this suite times —
`domContentLoaded`, `loadEvent`, `viewerFound`, `manifestRequest`,
`manifestResponse`, `infoRequest`, `infoResponse`, `firstTileRequest`,
`firstTileResponse`, `networkIdle` — **ordered by when each actually happened**,
not by an assumed canonical order (a deployment where `info.json` comes back
before the manifest response, say, would still get a correct breakdown). Each
step has:

- `atMs` — milliseconds since navigation start (`null` if never observed —
  timed out, selector never matched, or the run aborted before that point)
- `stepMs` — milliseconds since the *previous observed* step — i.e. how long
  that particular step took, which is usually more useful than the absolute
  time when comparing runs (a slower manifest response shows up directly as a
  larger `manifestResponse.stepMs`, without having to subtract two absolute
  timestamps yourself)
- `url` — the request/response URL for network-based steps, `null` for DOM
  lifecycle steps

`milestones.totalMs` is the `atMs` of the last observed step (equivalently, the
sum of every `stepMs`) — a single top-line number for "how long did this run
take, start to finish." A Cloudflare challenge sets `milestones` to `null`
entirely, since nothing past that point is real page-load behavior.

`milestones.jsChunksBetweenManifestAndInfo` counts script-type requests fired
strictly after the manifest response and up to the `info.json` request. In
practice this is largely the viewer parsing the manifest and fetching more of
its own (unbundled) JS chunks before it can act on it — see
`iiif_viewer_investigation/request_flow.md` §3–4 — so a regression here often
means "the viewer got heavier," not "the backend got slower." `null` if either
boundary (`manifestResponse`, `infoRequest`) wasn't observed for that run.

## Extending to a new host or viewer

1. Confirm the actual work-show URL path convention for that deployment (controller
   name varies by work type — check in a browser, don't assume).
2. Run once with defaults and inspect the resulting HAR/screenshot to see whether the
   default viewer selector, tile pattern, manifest pattern, and info pattern actually
   matched anything for that deployment's markup — adjust `IIIF_TEST_VIEWER_SELECTOR` /
   `IIIF_TEST_TILE_PATTERN` / `IIIF_TEST_MANIFEST_PATTERN` / `IIIF_TEST_INFO_PATTERN` if
   not (a mismatched pattern just leaves that step's `atMs`/`stepMs` `null` in the
   output — it doesn't error).

## Prior art

This suite formalizes ad-hoc investigation scripts from a manual debugging session
(Python + Playwright, see `iiif_viewer_investigation/bin/` for `capture_hykuup.py`,
`capture_ethos.py`, `trace_combined.py`) into a reusable, parameterized suite.
