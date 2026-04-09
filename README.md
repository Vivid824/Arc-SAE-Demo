# STATE Mechanistic Interpretability Explorer

A prototype visualization tool for exploring sparse features extracted from Arc Institute's STATE State Transition model on public Replogle K562 CRISPRi data.

## What this is

This app turns a real STATE activation export into a lightweight browser-based explorer. It shows feature-level gene associations, perturbation-level activation summaries, a cell embedding, a perturbation-by-feature heatmap, and a method tab that documents the extraction and interpretation pipeline. The current release is a **pipeline proof**: it demonstrates that we can extract set-conditioned residual-stream activations from a public STATE checkpoint, decompose them into sparse features, ground those features against genes and pathways, and ship the result as a clean static demo.

## What this is not

This prototype runs on **Replogle K562 Essential CRISPRi** data, not Tahoe-scale melanoma drug perturbation data. It is not a Trametinib/MPAS result and it does not claim causal steering or translational validation. Gene associations in the right rail are **expression correlations**, not decoder-weight projections. The current build should be interpreted as a public-data interpretability demo and release candidate for a richer future perturbation setting.

## Current release status

- Release framing: **Pipeline proof**
- Model: `arcinstitute/ST-HVG-Replogle`
- Activation source: STATE set-conditioned residual-stream activations
- Feature model: TopK sparse autoencoder, expansion `2x`, `k = 32`
- Export size: `5,120` cells, `20` perturbations, `50` features
- Current summary: `22` canonical overlaps and `40` features with at least one pathway hit at `adjP < 0.05`

## Pipeline

1. Load the public `ST-HVG-Replogle/fewshot/k562` checkpoint and capture one middle transformer-layer activation stream with forward hooks.
2. Build a 5,120-cell K562 export slice from checkpoint-aligned AnnData inputs and preserve exact row order across activation metadata and arrays.
3. Train a TopK SAE on the extracted activations with `k = 32` and expansion `2x`.
4. Compute gene associations by Spearman correlation using checkpoint-native gene ordering from `var_dims.pkl`.
5. Run local pathway enrichment against Hallmark and KEGG GMTs.
6. Export the final JSON bundle consumed by the static Vite app.

## Dataset and model provenance

- Dataset: Replogle et al. (2022) K562 Essential Perturb-seq
- DOI: `10.1016/j.cell.2022.05.013`
- Model family: Arc Institute STATE
- Public checkpoint path: `ST-HVG-Replogle/fewshot/k562`
- Association mode: `expression_correlation`

## Technical notes

- Activations are **set-conditioned**: each exported cell representation reflects the other cells in its matched inference window, not just that cell in isolation.
- Feature IDs such as `F0000` are assigned only at export time after ranking live features by attribution.
- Heatmap values are normalized for display only; sorting uses raw per-perturbation activation means from `features.json`.
- Shortcut scores currently use a library-size proxy rather than the richer metadata available in larger perturbation programs.
- Canonical Method-tab content is edited in `content/method.json`, synced to `/workspace/state-mvp/method.json`, and then re-exported into `public/data/method.json`.

## Live demo

Vercel deployment pending final screenshot pass and local browser QA.

## Honesty caveats

- This project should be described as a **working mechanistic-interpretability pipeline on public K562 STATE activations**.
- The rank-1 feature currently reflects a stress/metabolic axis rather than an obviously canonical MYC/E2F feature, so the strongest honest framing is pipeline validation, not novel biological discovery.
- If future builds add deep links or client-side routes, add a `vercel.json` rewrite to `/index.html` before relying on non-root URLs.
