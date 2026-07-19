"""Distill the teacher labels into a tiny MLP head over reduced embeddings.

Pipeline: PCA(300 -> --dims) -> L2 normalize -> int8 quantize -> dequantize ->
MLP(dims -> 64 -> 4, sigmoid*10). Training on the *dequantized* vectors means
zero train/serve skew: the browser sees exactly these inputs.

Artifacts: data/reduced.npz (int8 matrix + PCA params), data/head.npz (weights).

Usage: .venv/bin/python train_head.py [--dims 96] [--epochs 400]
"""

import argparse

import numpy as np
import torch
from torch import nn

from common import CHANNELS, EMB_NPY, HEAD_NPZ, REDUCED_NPZ, load_labels, load_vocab


def reduce_and_quantize(emb: np.ndarray, dims: int):
    mean = emb.mean(axis=0)
    centered = emb - mean
    # Economy SVD on the full 80k x 300 matrix is fine at these sizes.
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    components = vt[:dims]
    reduced = centered @ components.T
    norms = np.linalg.norm(reduced, axis=1, keepdims=True)
    norms[norms == 0] = 1
    unit = reduced / norms
    q = np.clip(np.round(unit * 127), -127, 127).astype(np.int8)
    return q, mean, components


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dims", type=int, default=96)
    ap.add_argument("--epochs", type=int, default=400)
    ap.add_argument("--hidden", type=int, default=64)
    args = ap.parse_args()

    words, _ = load_vocab()
    emb = np.load(EMB_NPY)
    labels = load_labels()
    print(f"vocab {len(words)}, labels {len(labels)}")

    q, mean, components = reduce_and_quantize(emb, args.dims)
    np.savez_compressed(REDUCED_NPZ, q=q, mean=mean, components=components)

    index = {w: i for i, w in enumerate(words)}
    rows = [(index[w], vals) for w, vals in labels.items() if w in index]
    x = torch.tensor(np.stack([q[i] for i, _ in rows]).astype(np.float32) / 127.0)
    y = torch.tensor(np.array([v for _, v in rows], dtype=np.float32))

    g = torch.Generator().manual_seed(7)
    perm = torch.randperm(len(x), generator=g)
    n_val = max(1, len(x) // 10)
    val_idx, tr_idx = perm[:n_val], perm[n_val:]

    model = nn.Sequential(
        nn.Linear(args.dims, args.hidden),
        # tanh approximation so the vanilla-JS forward pass matches exactly
        nn.GELU(approximate="tanh"),
        nn.Linear(args.hidden, len(CHANNELS)),
    )
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    def forward(inp):
        return torch.sigmoid(model(inp)) * 10.0

    for epoch in range(args.epochs):
        model.train()
        opt.zero_grad()
        loss = nn.functional.mse_loss(forward(x[tr_idx]), y[tr_idx])
        loss.backward()
        opt.step()
        sched.step()
        if epoch % 100 == 0 or epoch == args.epochs - 1:
            model.eval()
            with torch.no_grad():
                val_pred = forward(x[val_idx])
                mae = (val_pred - y[val_idx]).abs().mean(dim=0)
            print(
                f"epoch {epoch}: train mse {loss.item():.3f}, val MAE "
                + " ".join(f"{c}={m:.2f}" for c, m in zip(CHANNELS, mae))
            )

    # Export weights (sigmoid*10 baked into the runtime, not the file).
    with torch.no_grad():
        w1, b1 = model[0].weight.numpy(), model[0].bias.numpy()
        w2, b2 = model[2].weight.numpy(), model[2].bias.numpy()
    np.savez(HEAD_NPZ, w1=w1, b1=b1, w2=w2, b2=b2)
    print(f"head saved -> {HEAD_NPZ} ({sum(a.size for a in (w1, b1, w2, b2))} params)")

    # Sanity: top vocab words per channel according to the distilled head.
    model.eval()
    with torch.no_grad():
        all_scores = forward(torch.tensor(q.astype(np.float32) / 127.0)).numpy()
    for ci, c in enumerate(CHANNELS):
        top = np.argsort(-all_scores[:, ci])[:12]
        print(f"top {c}: " + ", ".join(words[i] for i in top))


if __name__ == "__main__":
    main()
