# Preregistered Biological Review

This note must be read before reviewing the corrected real export.

## Minimum expected patterns

- A proliferation / G1-S feature family should appear among the top features.
  Expected genes include: `MYC`, `E2F1`, `CCND1`, `PCNA`, `MCM2`, `MCM5`.
- A checkpoint or stress-response family may appear if supported by the selected perturbations.
  Expected genes include: `TP53`, `CDKN1A`, `MDM2`.

## What counts as K562-specific or more interesting biology

- A coherent `BCR-ABL` effector feature rather than generic proliferation arrest.
- A DNA-damage-response feature with genes such as `BRCA1`, `RRM1`, `RRM2`, `BUB1`, `AURKB`.
- An erythroid / heme-like program or another non-generic lineage-associated response.
- A perturbation-specific feature that activates for a coherent subset of perturbations with a shared mechanism beyond simple growth suppression.

## Review framing

- If the top features are mostly MYC / E2F / CDK proliferation structure, classify the result as `pipeline proof`.
- If at least one top-10 feature shows coherent perturbation-specific biology beyond generic proliferation arrest, classify the result as `interesting biology`.
- If neither condition is met convincingly, classify the result as `not ready`.
