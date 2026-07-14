# prod_results

Committed, named snapshots for before/after comparisons — see the main
[README](../README.md#comparing-runs-over-time) for how to generate one.

Each subdirectory is one labeled scenario (e.g. `baseline/`, `after-cdn-change/`)
containing:

- `summary.md` — output of `node scripts/summarize.mjs results --label <label>`
- the per-run JSON metrics files for that label (safe to commit — no headers/cookies)
- optionally a representative `screenshot.png`
- a short hand-written `README.md` noting what was being tested and any key
  takeaways

**Never commit a `.har` file here** — this repo is public, and HAR files capture
every response header on the page, including cookies and auth headers. HARs stay
in the local/PVC-scratch `results/` tree only.
