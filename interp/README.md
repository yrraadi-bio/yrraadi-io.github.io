# BSF KEGG Pathway Explorer

An InterProt-style browser for BSF dictionaries. Each "feature" is a KEGG pathway; for every pathway
you can see the blocks and layers that carry it, the top tiles, and — for each tile x block pair —
exactly which patches of the tile the block fires on.

Two model families are supported through `--model`, and the site is currently built from
**gigapath**:

| `--model` | dictionaries | gate | analysis root |
| --- | --- | --- | --- |
| `gigapath` | ViT-G layers 0, 1, 13, 18, 23, 29, 38, 39 at group size 3 | top 96 of 512 | `runs_bsf/prov_gigapath/xenium_16k_topk96/gene_pathway_feature_extraction` |
| `origin` | checkpoint-6 layers 1-4 at group sizes 3 and 16 | top 16 of 512 | `exp_01ky62547mfmmtb1tv91m2hawz/gene_pathway_feature_extraction` |

The two families differ in dictionary layout, activation sharding, checkpoint format and tile
identity, all of which are described by the `MODELS` profiles in `build_site_data.py`. Both share
`tile_id` as the tile key: Origin sets it to the sequence id, GigaPath to `SLIDE:source_row`.

The header's **Reload assets** button re-fetches `index.html`, `app.js`, `styles.css` and the pathway
data with `cache: "reload"` before reloading the page, which is the fix for a tab left open across a
rebuild. The header also prints the data build stamp, so a successful refresh is visible.

## Quick start

This directory is the published site, served at `/interp/` on GitHub Pages. Locally:

```bash
bash interp/serve.sh
# homepage: http://127.0.0.1:8791/
# explorer: http://127.0.0.1:8791/interp/
```

Rebuild the data bundle (read-only against the analysis outputs and BSF checkpoints, which live in
`silico-folder` and `origin-2.0` rather than in this repo):

```bash
conda activate /home/viraj/silico-folder/pt_fsdp
export OMP_NUM_THREADS=16
python interp/build_site_data.py --model gigapath --pathways 400 --blocks 6 --tiles 6
```

`--pathways` caps at however many pathways have held-out support, 286 for either model.

Every build first re-encodes a few tiles per dictionary and compares them against
`tile_block_activity`, because the site's evidence and its overlays must come from the same linear
map. A wrong encoder orientation lands at `max|diff|` near 3 with correlation near 0.1, whereas the
`1e-2` gaps that show up on single blocks are top-k gate ties flipping on float16 activations and are
harmless. The check raises rather than warns.

## What the numbers mean

Patch highlighting is the same quantity the feature-extraction pipeline scores blocks with, resolved
per patch instead of averaged over the tile:

1. Normalize the cached layer activations with the block's train mean and scalar scale.
2. Affine encode, then take the L2 norm of each 512 block's coordinates at every patch.
3. Zero every block outside the strongest `l0` at that patch (96 for GigaPath), matching the trained gate.

Averaging the resulting patch map over a tile and applying `log1p` reproduces the `activity` value
stored in `tile_block_activity/task_*.parquet` to about 5e-7 for GigaPath, so the overlay is the real
encoding rather than a proxy.

| field | meaning |
| --- | --- |
| held-out effect | block-pathway effect measured once on the 12 sealed slides |
| train effect | same effect fit on the 46 training slides |
| ΔR² | pathway variance explained beyond the covariate-only model |
| peak patch | largest gated block norm across the tile's 196 patches |
| peak : mean | peak divided by the mean over firing patches, a spatial selectivity measure |
| pathway score | the tile's KEGG pathway expression score (training slides only) |
| gene mean | gene's mean `log1p(count / library_size * 1e6)` across training tiles where it is measured |
| green patch | mean per-cell `log1p CPM` of the selected gene over cells falling in that patch |

Clicking a gene chip maps that gene onto the tiles as **green squares** filling the whole patch, so
a gene's footprint is directly comparable to a block's; where the two coincide, the block keeps a
blue ring at the patch edge. Xenium measures expression
once per cell-centred 256px patch, so a tile's own vector holds no sub-tile detail; the localization
instead comes from the shard's `neighbor_idx`/`neighbor_dxdy` arrays, which list neighbouring cell
measurements with normalized offsets where ±1 spans the tile footprint. Those cells are binned onto
the same 14×14 grid as the block activations and averaged per patch, so blue (block firing) and green
(gene expression) are directly comparable in position. Patches with no measured cell are left
unmarked on the tile, and the modal's fourth panel separates the three cases explicitly: grey for no
cell measured, pale for a cell carrying no transcript, green for expression. Values are per-cell
`log1p CPM`; at ~140 counts per cell they are coarse and read closer to detection than to level.

"Top expressed genes" lists the pathway's measured genes ranked by mean training expression, taken
from `gene_score_parameters_train.parquet` — the same per-gene mean the pipeline uses to standardize
genes when it builds pathway scores. Because that scoring z-scores every gene, a highly expressed
gene does not automatically dominate its pathway's score; the list describes expression level, and
each chip's tooltip carries the standard deviation and slide coverage. A dashed border marks genes
missing from some slide panels.

Blocks are restricted to held-out **supported** pathway associations, ranked by |held-out effect|.
Tiles are shortlisted by mean block activity, then ranked by peak patch activation so overlays show
localized structure.

The "By pathway score" tab instead ranks tiles by measured pathway expression and holds that order
fixed across blocks, so the same tiles are comparable block to block. Every score tile stores one
patch map per displayed block (`by_block`), which is what makes block selection change the overlay
there. Tiles where fewer than half the displayed blocks fire are dropped during the build, since
nothing useful can be shown on them; a selected block that happens to be silent on a kept tile is
labelled rather than hidden.

## Known issue with the `origin` profile

`--model origin` currently fails the encoding check on its four `group_size=3` dictionaries
(L1-L4 gs3, i.e. `block_global_index` 0-511, 1024-1535, 2048-2559 and 3072-3583). Their stored
`tile_block_activity` only reproduces if `W_enc` is transposed, at `max|diff|` near 3 and correlation
near 0.07 otherwise.

Untransposed is the correct orientation: `VanillaBSF.encode` computes `x @ W_enc`, and the checkpoints'
own `architecture.reference_hashes` pin `silico-folder/eval/bsf/bsf/vanilla.py`, which builds `W_enc` as
`W_dec.t()`, so `W_enc` is `[d, blocks * group_size]`. Those dictionaries are square (1536x1536), so
an earlier version of the analysis's orientation rule transposed them, and the current toolkit no
longer does — but the affected outputs were never regenerated. The `gigapath` dictionaries are
unaffected and reproduce exactly. Fixing this means re-running the Origin encode stage, not adding a
transpose here.

## Layout

- `build_site_data.py` — builds `data/index.json`, `data/pathways/<hsa>.json`, and `tiles/*.jpg`
- `index.html`, `app.js`, `styles.css` — the static viewer, no build step
- `serve.sh` — local static server

Per-model sources live in the `MODELS` profiles in `build_site_data.py`; tile images and gene
localization come from `silico-folder/data/spatial_shards_hest_v1/xenium` for both.
Point `--root` / `--run-root` at the top-96 outputs to rebuild against those dictionaries once they finish.
