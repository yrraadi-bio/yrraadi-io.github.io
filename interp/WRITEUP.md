# What the BSF KEGG Pathway Explorer shows

## The idea

Instead of asking "what does this neuron mean?", this explorer asks the reverse: for a given
biological process, which learned features carry it, and where in the tissue do they fire?

The features are **blocks** from a block-sparse featurizer trained on frozen
[Prov-GigaPath](https://github.com/prov-gigapath/prov-gigapath) histology patch tokens. The biology
is **KEGG pathways**, measured in the same tissue by Xenium spatial transcriptomics. Pick a pathway
and you get the blocks and layers that track it, the tiles where they fire hardest, and for each
tile the individual patches driving the block. Selecting a gene overlays where that gene is actually
transcribed, so the feature's spatial footprint and the biology's sit in the same frame.

The interaction model comes from [InterProt's SAE
visualizer](https://interprot.com/#/sae-viz/SAE4096-L24/30), which highlights the residues where a
sparse protein feature activates. Here the sequence is a tissue tile and the residues are patches.

Data is 58 Xenium slides, split by slide into 46 for training and 12 held out.

## How it works

**Sparse features.** One dictionary per layer, at eight layers sampled across GigaPath's depth. Each
holds 512 blocks, and a top-k gate keeps only a fraction active at any patch, so a patch is described
by a short list of blocks rather than a dense vector.

**Two measurements per tile.** A block's activity is its gated response averaged over the tile's
patches. A pathway's score is its member genes' expression, standardized on training tiles and
averaged over the genes each tile actually measures — genes absent from a slide's panel are excluded
rather than treated as zero, since zero would read as "off" instead of "unmeasured".

**Association.** For every block-pathway pair, a partial correlation between the two, after removing
nuisance signal: staining colour, tissue occupancy, cell count, library size, panel and tissue type.
Everything is centred within slide, so a block that merely distinguishes one slide's staining from
another's cannot pick up credit for it.

**Filtering.** One global false-discovery correction across all tests, rather than per block or per
pathway. Survivors are then re-tested against nulls that shift each slide's measurements while
preserving its spatial structure — tissue is autocorrelated, so a naive shuffle makes almost any
signal look significant.

**Validation.** Training coefficients are frozen before any held-out expression is read. They are
then applied once to the sealed slides, and a pair counts as **supported** only if the held-out
effect keeps the same sign, improves on a covariate-only model, and has a bootstrap confidence
interval excluding zero — resampled at the slide level, since tiles within a slide are not
independent.

**What the site draws.** The patch overlays are not a saliency approximation. They are the same
quantity the statistics are built on, stopped one step earlier, before averaging over patches; the
build verifies this and refuses to publish if it disagrees. Gene overlays come from per-cell
measurements binned onto the same patch grid, which is what makes the blue and green layers
positionally comparable.

## Results

About **73,000 of 271,000** candidate block-pathway pairs survived held-out validation, spanning
**286 pathways** and **2,829 blocks**.

Coverage is near-total. Roughly a third of blocks are constant and untestable; of those that can be
tested, all but two carry at least one supported pathway association. Essentially every live block in
these dictionaries has some measurable relationship to transcription.

Individual effects are small. The median supported partial correlation is about **0.09**, and the
median pair explains under **1%** of pathway variance beyond covariates, with a thin tail reaching far
higher. The result is many weak but reproducible links, not a dictionary of clean pathway detectors.
Positive and negative directions are near-balanced, as expected if blocks track tissue state rather
than a single "more biology" axis.

**Pathway information rises with depth**, strictly, across all eight layers — the deepest layer
carries nearly seven times the supported associations of the shallowest, and almost its entire
dictionary participates. This runs opposite to reconstruction quality: the early layers the
featurizer reconstructs almost perfectly are the least informative about transcription, while the
layers hardest to compress carry the most biology. Ranked by effect size the concentration is
sharper still, with the strongest blocks drawn almost entirely from the final third of the network.

## Caveats

- **Association, not mechanism.** A supported pair means a block tracks a pathway on unseen slides
  after controlling for staining and cellularity. It does not mean the block encodes that pathway.
- **KEGG gene sets overlap heavily**, so a block linked to many pathways may be tracking one shared
  program rather than many distinct ones.
- **Gene overlays read closer to detection than to level**, given how few transcripts are counted per
  cell.
- **Tile galleries are illustrative.** They rank tiles by training-slide scores; the evidence is the
  held-out column, not the pictures.

Exact figures, file paths and rebuild instructions are in `README.md` alongside this document.
