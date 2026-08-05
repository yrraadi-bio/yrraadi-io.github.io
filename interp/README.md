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

One naming note: the site calls a block a **feature**, while the analysis outputs, the JSON keys and
the code keep `block` (`block_global_index`, `data/blocks/`, `blockLabel`). Only the prose in
`copy.js` and `index.html` was renamed, so the two vocabularies meet at the rendering boundary and
nowhere else.

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

`--pathways` caps at however many pathways have held-out support, 286 for either model, and
`--blocks` caps the block cards each pathway keeps. Both are floors rather than exact counts: the
build also exports every (set, feature) pair the feature axis cards, which is why the KEGG bundle
holds 183 pathways and 1,922 block cards at `--pathways 60 --blocks 5`. Those pairs come from
`dominance.carded`, so both builds cut the same list and no card on the site is dead: a card whose
document holds no card back could be clicked and would open some other feature's evidence.

The explorer reads the same evidence along either axis, and the block-first axis inverts what the
pathway documents already hold:

```bash
python interp/build_block_view.py
```

That writes `data/blocks/index.json`: every block with an association clearing `MIN_EFFECT` in
held-out |r|, its strongest `SETS_PER_BLOCK` such gene sets, and the genes it clusters pooled over
them. The explorer opens on this axis, and every card it lists can be selected, because
`build_site_data.py` exports the same pairs. The floor is a constant at the top of `dominance.py` and it exists because the tail of
blocks near |r| 0 is not worth scrolling. It applies to the cards as well as to the blocks:
`supported` only asks whether an effect is distinguishable from zero over
the 12 held-out patients, which an |r| of 0.075 on 3,310 tiles can pass with a bootstrap interval of
[0.014, 0.145] and a ΔR² of 0.002, so a block that clears the floor once would otherwise still show
sets that carry nothing. Blocks with no exported tile manifold are dropped too, since a block firing
on a couple of dozen of the 16,000 tiles has nothing to browse and an effect measured over that
handful is not worth listing. Run it after `build_site_data.py`, since it reads that output for its
cards and the analysis roots named in it for the rest. A block's top tiles are identical in every set
that lists it, which is why the block view can reuse a pathway document for its tiles instead of
storing its own copy.

The documents hold supported associations only, so the block view shows what reproduced and nothing
else. Held-out r is averaged over 12 patients while training r is pooled over 46 slides, so the
held-out figure is the noisier of the two and requiring it to hold selects its upper tail; a card's
held-out r therefore reads high relative to its training r by construction.

## Which cards keep their colour

A block that tracks a dozen sets equally well has said nothing about any of them, so the site greys
every association except the one a block's evidence singles out. `dominance.py` holds that rule and
both build scripts read it: a block points at one set when its strongest |held-out r| beats the mean
of that block's other effects above `MIN_EFFECT` by a further `MIN_EFFECT`. Only held-out r enters
it, and it is measured over every association the block reproduces, read from
`pathway_transfer_heldout.parquet` rather than from the documents, pooled across the collections
scored against the same encoder run. A rule read off the documents would only ever nominate a block
for a set it already ranked into, and it did: under the documents alone, 96 blocks looked like they
pointed at a set, and for 61 of them the set was not the block's strongest reproduced association.

The rule then decides part of what gets exported, because a winning set with no card on its block
has no tiles, genes or colouring to stand on, and crediting the runner-up instead would name a set
the evidence did not pick. `build_site_data.py` therefore exports every winning set as a document and
forces its winning blocks into that document's cards whatever their rank, on top of the
`--pathways` and `--blocks` cuts. For KEGG that is 65 extra sets and 214 forced cards; for Hallmark,
14 sets and 50 cards. Before this the export cap decided the answer instead of the evidence: 264
blocks single out a set and only 21 of them landed on a set the build had exported.

Of the 1,967 blocks that reproduce anything, 264 single out a set and 256 are credited, the other 8
being blocks with no tile manifold that the block list drops anyway. The result is written to
`data/blocks/dominance.json` as `block_global_index -> {slug, pathway_id}`, 14 KB, which the explorer
loads up front and greys from along either axis: in the block view every set but the winner is
greyed, and in the pathway view every block that does not point at the set on screen is greyed. The
block list's default order puts blocks that point at a set first, each marked with a dot, ranked by
|held-out r| inside both groups.

The feature axis reads its cards from `pathway_transfer_heldout.parquet` rather than from the
exported documents. A card list read off the documents showed features a single weak set and then
greyed it for losing to sets the reader could not see: feature #0-150 carded bile acid metabolism at
0.103 alone, greyed, with the six stronger sets that outvoted it nowhere on the page. The 380 listed
features reproduce 7,003 associations above the floor; the strongest `SETS_PER_BLOCK` of each are
carded, 1,798 cards in all, and the greying rule still weighs the rest. `dominance.carded` names
those pairs and `build_site_data.py` exports every one of them, so all 1,798 can be selected, greyed
or not, and `audit_site.py` reports the count that cannot. Both builds sort at full precision, since
two effects that round to the same displayed r would otherwise swap places at the cut and card a set
the bundle never exported. `data/blocks/index.json` is 1.4 MB, 140 KB over the wire.

A set can reproduce inside a feature without any of its genes being measured there, so 25 features
have no gene chips and the gene section hides itself rather than leaving an empty heading.

A set carried by dozens of features is a wall rather than a finding, so both card sections draw the
strongest `CARD_LIMIT` cards and every card the greying rule kept, in rank order and skipping
whatever falls in neither group: allograft rejection opens on its top 8, all greyed, then its 6 kept
cards, two of which rank in the sixties. A pill beside the heading counts the kept cards ranked below
the top and folds them away on click, leaving the top of the list alone, and the answer is remembered
in `localStorage` under `interp.showAllCards`. The card the page is currently built around is always
drawn, since the genes, the manifold and the tiles below follow it. The bars are scaled over every
card rather than the drawn ones, so a skipped card cannot restretch the visible.

The cross-block map's "strongest pathway" colouring is a different quantity and says so: it is each
block's largest reproduced effect with no margin required, so a block coloured there can still be
grey on every card.

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
the same 14×14 grid as the block norms and averaged per patch, so blue (block firing) and green
(gene expression) are directly comparable in position. Patches with no measured cell are left
unmarked on the tile, and the modal's fourth panel separates the three cases explicitly: grey for no
cell measured, pale for a cell carrying no transcript, green for expression. Values are per-cell
`log1p CPM`; at ~140 counts per cell they are coarse and read closer to detection than to level.

"Genes clustered in this block" ranks the pathway's measured genes by how tightly each one clusters
inside the selected block, so the list changes with the selected block rather than describing the
pathway alone. The statistic is Moran's I of per-tile expression over a 10-nearest-neighbour graph
built in the block's own coordinate space, the `group_size` numbers it assigns every tile it fires
on, read from `signed_coordinate_mean`. It is high when tiles that agree on the gene sit together in
that space, which is what makes the gene visibly separate when the manifold is recoloured by it.
Expression is the pipeline's own `log1p(raw_count / raw_library_size * 1e6)`, blanked wherever the
analysis could not use it: panel entries a slide never measured, QC-failed tiles, empty libraries.

Ranking this way rather than by abundance means a gene needs enough signal inside the block to be
scored at all, so genes below the detection floors are dropped instead of ranked last. Each chip
carries both numbers, `I` the clustering it is ranked by and `r` its correlation with the block's
activation, since a gene can cluster tightly and still barely track how hard the block fires. Its
tooltip carries the slide-centred variant of the clustering score. That variant removes each slide's own
mean first and is much smaller than the raw score, which says most of the apparent clustering is
slide identity: a slide's tiles both group in the block's space and share an expression level. A
dashed border still marks genes missing from some slide panels.

Blocks are restricted to held-out **supported** pathway associations, ranked by |held-out effect|.
Tiles are shortlisted by mean block norm, then ranked by peak patch norm so overlays show
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
- `build_block_view.py` — inverts those documents into `data/blocks/index.json` for the block-first view
- `dominance.py` — the floor, the card cut and the set each block points at, shared by both build scripts
- `audit_site.py` — checks that everything the viewer can navigate to exists and agrees
- `index.html`, `app.js`, `styles.css` — the static viewer, no build step
- `copy.js` — every explanatory string the viewer shows
- `serve.sh` — local static server

Run `python interp/audit_site.py` after any rebuild. It walks every listed feature and every exported
set and reports anything the viewer could reach and not find: a feature with no tile manifold or no
selectable set, a card whose document is missing or holds no card back, a gene pointing at a set that
is not on screen, a set credited by the greying rule but not carded, a pathway with no colouring.

`index.html` loads the three local assets with a `?v=` stamp; bump it whenever one of them changes,
or a browser will keep running the version it cached and can pair old code with new data. The data
documents are rebuilt in place under stable names, so `loadJson` fetches them with `cache: no-cache`
and lets the server revalidate: without it a browser can pair a fresh `blocks/index.json` with a
months-old manifold index and report manifolds as missing that are sitting on disk.

Per-model sources live in the `MODELS` profiles in `build_site_data.py`; tile images and gene
localization come from `silico-folder/data/spatial_shards_hest_v1/xenium` for both.
Point `--root` / `--run-root` at the top-96 outputs to rebuild against those dictionaries once they finish.
