# data/

Training data for wiz-tower's attacker (Phase 6 Slice 3b).

- **`runs/*.json`** — human run logs. In the game, play a run and click **⬇ Export run log**
  (on the Core-shattered screen) or call `window.wt.exportRun()` mid-run. Drop the downloaded
  JSON here. Each wave contributes a real expert defense as a teacher board.
- **`dataset.json`** — the board features + leak-surface labels the last `npm run train`
  generated (the "DA" — dataset the student is distilled from). Regenerated each run.

Both are git-ignored (they're generated / your own data).
