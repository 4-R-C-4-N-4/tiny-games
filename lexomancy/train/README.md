# lexomancy training pipeline

Distills a word→spell scorer small enough to ship in a static page: int8
PCA-reduced GloVe embeddings + a tiny MLP head trained on labels from a local
LLM teacher. Rerunnable end-to-end on one machine; the GPU is only needed for
the teacher (ollama).

## One-time setup

```sh
python3 -m venv --system-site-packages .venv   # reuses system torch/numpy
.venv/bin/pip install wordfreq
# sources cached in ~/.cache/lexomancy/:
curl -L -o ~/.cache/lexomancy/glove.6B.zip https://nlp.stanford.edu/data/glove.6B.zip
unzip -d ~/.cache/lexomancy ~/.cache/lexomancy/glove.6B.zip glove.6B.300d.txt
curl -L -o ~/.cache/lexomancy/words_alpha.txt \
  https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt
```

## Pipeline (run in order)

| Step | Script | Output | Notes |
|------|--------|--------|-------|
| 1 | `build_vocab.py` | `data/vocab.tsv`, `data/embeddings.f32.npy` | GloVe ∩ wordfreq ∩ dictionary, 80k words by zipf, curated words force-included |
| 2 | `label_teacher.py` | `data/labels.jsonl` | ~4k words scored 0-10/channel by qwen3:8b via ollama. Resumable — rerun freely. **Committed**: this is the distillation dataset. |
| 3 | `train_head.py` | `data/head.npz`, `data/reduced.npz` | PCA→96d, L2-norm, int8; MLP 96→64→4 trained on the *dequantized* vectors (zero train/serve skew). Prints val MAE + top-words sanity. |
| 4 | `export_assets.py` | `../web/public/lexicon.bin`, `../src/model-scorer.golden.json` | Packs vocab+vectors+zipf+head+anchor centroids (~8MB). Goldens pin the TS scorer to python bit-for-bit-ish. |

All scoring formulas (softmax temperature, rarity/power/cost curves) live in
`common.py:SCORING` and ship inside the asset header — python and TS can't
drift apart, and `src/model-scorer.test.ts` enforces it against the goldens.

## Content assets

`data/anchor-words.json` is hand-authored shipping content: channel seed sets
(teacher rubric + eval), the five stat anchors (Self-Naming Rite), and the
theme library (floor domains/taboos). Anchors ship as embedding centroids —
edit the wordsets, rerun step 4, done.

## Tuning knobs

- Teacher model: `label_teacher.py --model` (any ollama model; test a batch first)
- Vocab depth: `build_vocab.py --cap/--min-zipf` (deeper tail = bigger asset)
- Asset size: `train_head.py --dims` (96d ≈ 8MB; 64d ≈ 5.5MB, blurrier similarity)
- Game feel: `common.py:SCORING`, then rerun `export_assets.py` only
