# STATE analysis scripts

These scripts are the canonical local source-controlled entry points for the
offline pipeline. They are meant to be synced to the remote Vast workspace at
`/workspace/state-mvp/analysis/` and run there against the remote workspace
layout:

- `/workspace/state-mvp/checkpoints/`
- `/workspace/state-mvp/data/`
- `/workspace/state-mvp/analysis_data/gmts/`
- `/workspace/state-mvp/artifacts/`
- `/workspace/state-mvp/exported_data/`

## Script order

1. `00_remote_preflight.sh`
2. `01_setup_env.sh`
3. `02_smoke_import.py`
4. `03_smoke_load_checkpoint.py`
5. `04_inspect_signatures.py`
6. `05_list_modules.py`
7. `06_extract_activations.py`
8. `07_train_sae.py`
9. `08_compute_associations.py`
10. `09_pathway_enrichment.py`
11. `10_export_frontend_json.py`

## Notes

- The default data path is the Arc-hosted `replogle_concat.h5ad` file from
  `arcinstitute/State-Replogle-Filtered`, because the direct Figshare K562 file
  is often blocked by AWS WAF on cloud hosts.
- The direct Figshare K562 file remains supported as an explicit opt-in data
  source when it can be downloaded and validated locally.
- Intermediate artifacts are keyed by `latent_idx`; final feature IDs are only
  assigned in `10_export_frontend_json.py`.
- `matrix.json` is normalized for display only. Raw perturbation means live in
  `features.json`.
- `content/method.json` is the canonical local Method-tab source and should be
  synced to `/workspace/state-mvp/method.json` before export.
- `ST-Parse` is not an automatic fallback here. The only automatic post-timebox
  fallback remains `SE-600M` unless a concrete small Parse-compatible AnnData
  input is locked first.
