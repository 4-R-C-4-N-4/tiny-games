# Distilled attacker — a tiny model that ships as JSON + a JS forward pass

**Proven:** distill a search-over-the-sim teacher into a tiny model and run it client-side
with **no runtime** — no backend, no API key, no WASM, no ONNX. The model is `weights.json`
read by a ~15-line JavaScript forward pass. This is the core ML bet of the project, validated.

## The pipeline (all-JS)

1. **Sim + type chart** — the 7-element wheel (Sonic→Earth→Zap→Ice→Fire→Sonic; Light↔Dark
   mutual) plus trait/capability gaps (Flier needs anti-air, Shade needs detection, Swarm
   needs splash). In the shipped project this is `sim.ts`, run headless under Node.
2. **Teacher = exhaustive search.** For each defense, score all 28 `element × trait` waves
   through the sim and take the max-leak attack. No pretrained model — the *simulator* is the
   oracle.
3. **Student = ~2,524-param MLP** (`10 → 64 → 28`), distilled from the teacher's full leak
   surface (soft targets), trained in numpy (`train.py`).
4. **Ship** = `weights.json` + the forward pass in `index.html`. That's the whole runtime.

## Results (measured)

| | value |
|---|---|
| Student params | **2,524** |
| `weights.json` | ~55 KB (raw JSON; trivially gzips smaller) |
| Exact-pick agreement with exhaustive search | **~75%** |
| Leak regret when it disagrees | **~0.4%** of optimal (misses are near-ties) |
| JS forward pass vs numpy | exact-match argmax |

The net clearly learned to read the defense and attack the gap (a defense-blind baseline is
~8%, random ~3.6%), and its rare disagreements with search cost almost no leak.

## Run it

```bash
python3 train.py          # bootstrap sim + search teacher + distill -> weights.json
python3 -m http.server    # serve the folder (fetch() needs http, not file://)
# open http://localhost:8000/index.html  — sliders set your defense, the model reacts
```

`index.html` contains the entire model runtime: `fetch('weights.json')` + `forward(x)`
(two matmuls + ReLU). Copy those ~15 lines straight into the game.

## The one seam to know about

`train.py` currently ships a **bootstrap** copy of the sim in Python so the pipeline runs
today. Once `sim.ts` exists (Phase 0), that copy goes away: a headless Node run of `sim.ts`
exports a `(observation, leak_vector)` dataset as JSON, and `load_dataset()` in `train.py`
reads it instead. The ML half (search-teacher distill) stays in Python; only the data source
changes. This keeps **one sim** — the thing that trains the model is the thing that runs the
game.

## Where this is reduced vs the real game

This POC flattens the spatial board into a coverage vector to stay one-file. The real game
keeps the open field, flow-field pathing, and breaching, so the observation is a spatial
feature grid and the student gains a small conv encoder in front of this same recipe. The
pipeline — **search teacher → soft-target distill → weights.json → JS forward pass** — is
exactly the one that scales up.
