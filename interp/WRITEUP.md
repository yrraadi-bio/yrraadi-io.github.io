# What the BSF KEGG Pathway Explorer shows

## The idea

A vision transformer trained on histology learns *something* in its residual stream, but a raw
activation vector is not a hypothesis you can test. This explorer takes the opposite direction of
travel: instead of asking "what does neuron 4,213 mean?", it asks "for a given biological process,
which learned features carry it, and where in the tissue do they fire?"

The features are **blocks** from a block-sparse featurizer (BSF) trained on frozen
[Prov-GigaPath](https://github.com/prov-gigapath/prov-gigapath) ViT-G patch tokens. The biology is
**KEGG pathways**, measured directly in the same tissue by Xenium spatial transcriptomics. For every
pathway you can see which blocks and which layers carry it, the tiles where those blocks fire
hardest, and — for each tile-block pair — exactly which of the tile's 196 patches the block
responds to. Selecting a gene overlays where that gene is actually transcribed, so a block's
spatial footprint and the biology's spatial footprint sit in the same coordinate frame.

The interaction model is borrowed from [InterProt's SAE
visualizer](https://interprot.com/#/sae-viz/SAE4096-L24/30), which lights up the residues of a
protein where a sparse feature activates. Here the sequence is a tissue tile and the residues are
patches.

## The cohort

58 Xenium slides, split at the slide level into **46 training** and **12 held-out**, with 16,000
sampled tiles (12,690 train / 3,310 held-out). Each tile is a 256px histology patch tokenized into
a 14x14 grid of 196 patch tokens at width 1,536. Gene expression comes from a 1,656-gene panel axis.

The held-out slides were sealed: no held-out expression is read until every candidate association
has been frozen. That ordering is enforced by the pipeline's own audit
(`no_heldout_before_freeze`), not by convention.

## How the numbers are computed

**1. Sparse features.** One vanilla BSF per layer, at 8 layers sampled across GigaPath's 40:
`0, 1, 13, 18, 23, 29, 38, 39`. Each dictionary has 512 blocks of 3 coordinates, and a top-k gate
keeps the strongest **96 of 512** blocks at every patch. That is 4,096 blocks total. Reconstruction
R² averages **0.9095**, with per-layer held-out R² from 0.8266 (layer 29) to 0.9994 (layer 1) —
the earliest layers are nearly lossless, and reconstruction gets harder with depth.

**2. Block activity per tile.** Normalize the cached activations with the train-fit mean and scalar
scale, affine encode, take the L2 norm of each block's 3 coordinates at every patch, zero everything
outside the top 96 at that patch, then average over the tile's 196 patches and apply `log1p`. This
single scalar per (tile, block) is what every association is fit on.

**3. Pathway scores per tile.** Gene counts become `log1p(count / library_size * 1e6)`. Each gene is
z-scored using means and standard deviations fit on training tiles only. A pathway's score is the
mean z-score over the genes *actually measured* in that tile — genes missing from a slide's panel
are excluded rather than zero-filled, since a zero would read as "not expressed" instead of "not
measured". KEGG comes from a pinned 2026-07-16 snapshot; 287 pathways clear the 3-measured-gene
floor, with a median of 18 measured genes (range 3-155).

**4. Association.** For each (block, pathway) the effect is the **partial correlation** between block
activity and pathway score, after within-slide centering and after residualizing out 11 nuisance
covariates: tissue type, gene panel, tissue occupancy, mean RGB, hematoxylin and eosin proxies,
cell count, and raw library size. Within-slide centering matters — without it, any block that merely
distinguishes one slide's staining from another's would correlate with anything that varies between
slides.

**5. Multiple testing and spatial nulls.** Every one of the 6,023,990 estimable block-gene tests
(from 6,782,976 attempted) goes into a **single global Benjamini-Hochberg family** at α = 0.05, and
895,324 pass. One family, not one per block or per pathway, so the correction is not weakened by
splitting. Because tissue is spatially autocorrelated, a plain permutation null is too generous:
shuffling tiles destroys structure the block could never have exploited, making almost any real
signal look significant. Surviving candidates are therefore re-tested against 100
deterministic within-slide toroidal shifts, which preserve each slide's spatial structure while
breaking its alignment to the block. Pathways are tested two ways: directly against the pathway
score, and by over-representation (ORA) among each block's top 10/20/40 genes.

**6. Held-out validation.** Training coefficients are frozen, then applied once to the 12 sealed
slides. A pair is marked **supported** only if all three hold:

- the held-out effect has the **same sign** as the training effect,
- the model including block activity beats the covariate-only model, **ΔR² > 0**,
- the **95% confidence interval excludes zero**, from 2,000 bootstrap draws resampled at the *slide*
  level rather than the tile level.

Slide-level resampling is the conservative choice: tiles within a slide are not independent, so
bootstrapping tiles would shrink the intervals artificially. The run records its resampling unit as
`slide` with patient identity unverified, so if any two slides come from the same patient the
intervals are still mildly optimistic.

**7. What the site draws.** Patch overlays are not a proxy or a saliency approximation — they are
step 2 stopped one level earlier, before the average over patches. Averaging the drawn patch map and
applying `log1p` reproduces the stored activity value to **5e-7**, and the build refuses to publish
if that check fails. Gene overlays exploit the fact that Xenium measures expression per cell-centred
patch: neighbouring cell measurements carry normalized offsets, which are binned onto the same 14x14
grid, so blue (block firing) and green (gene expression) are positionally comparable.

## Results

Of **271,051** frozen candidate block-pathway pairs, **72,918 (26.9%)** survived held-out
validation, covering **286 of 287 pathways** and **2,829 distinct blocks**.

The coverage figure is the striking one. 1,265 of the 4,096 blocks are constant and therefore not
estimable — they are retained and marked, never silently dropped. Of the **2,831 blocks that can be
tested, 2,829 carry at least one held-out-supported pathway association**. Essentially every live
block in the dictionary has some measurable relationship to transcription.

Effects are real but individually small. The median supported |partial correlation| is **0.090**,
rising to 0.225 at the 99th percentile and 0.554 at maximum. Median ΔR² is **0.0061** — six-tenths of
a percent of pathway variance beyond covariates — though the strongest pair reaches **0.418**. So the
honest reading is a large number of weak, reproducible links plus a thin tail of strong ones, not a
dictionary of clean pathway detectors. Directions are near-balanced (37,712 positive, 35,206
negative), which is what you would expect if blocks track tissue state rather than a single axis of
"more biology".

Gene-level associations behave similarly but slightly stronger: **89,055 of 825,439** candidates
supported, spanning 1,166 genes and 3,235 blocks, median |effect| **0.111** and maximum 0.791.

**Pathway information increases with depth**, and the count of supported pairs does so strictly
monotonically across all eight layers. This is the clearest structural finding:

| layer | 0 | 1 | 13 | 18 | 23 | 29 | 38 | 39 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| supported pairs | 2,583 | 2,901 | 4,050 | 5,008 | 9,210 | 14,064 | 17,542 | 17,560 |
| distinct blocks | 158 | 224 | 219 | 289 | 449 | 492 | 499 | 499 |

Layer 39 carries nearly 7x the supported pairs of layer 0, and by layer 38 almost the entire
dictionary (499 of 512) participates. Note this runs *opposite* to reconstruction quality: the early
layers that are easiest to reconstruct (R² 0.999) are the least informative about transcription,
while the hardest layers to compress carry the most biology. A block-count comparison alone would
understate this, since layer 1 already involves 224 blocks; what changes with depth is how many
pathways each block relates to. Rank the blocks by effect size and the
concentration is sharper still — of the 300 strongest blocks across the 60 pathways displayed, 289
come from layers 29, 38 and 39, and layers 0 and 1 contribute none.

For comparison, the same pipeline run against a different feature family (Origin checkpoint-6
residual stream, top-16 gate) yielded 20,949 supported pairs over 2,462 blocks — GigaPath's top-96
dictionaries produce roughly 3.5x more validated associations, though the two differ in both encoder
and gate width, so this is not a controlled comparison of either factor alone.

The published site renders the 60 pathways with the most supported blocks, showing the top 5 blocks
per pathway by |held-out effect|, 6 tiles per gallery, and the 12 highest-expressed genes per
pathway, backed by 643 tile images.

## Caveats worth stating

- **Association, not causation, and not mechanism.** A supported pair means a block's activity tracks
  a pathway's expression on unseen slides after controlling for staining and cellularity. It does not
  mean the block encodes that pathway.
- **Pathway scores are correlated with each other.** KEGG gene sets overlap heavily, so a block
  supporting many pathways may be tracking one shared program rather than many distinct ones. The
  per-block label cap of 4 in the annotation table is a partial guard, not a solution.
- **Gene overlays read closer to detection than to level.** At roughly 140 counts per cell, per-cell
  `log1p CPM` is coarse.
- **The gallery ranks tiles using training-slide scores**, so the tile views illustrate the
  relationship rather than provide additional evidence for it. The evidence is the held-out column.

Sources, exact file paths and rebuild instructions are in `README.md` alongside this document.
