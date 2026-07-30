"use strict";

// Every explanatory string the explorer shows, kept apart from the rendering logic so wording
// can change without touching behaviour. Values are plain strings or functions of the numbers
// they quote. Short control labels stay in app.js next to the widgets they belong to.

const COPY = {
  sidebarEmpty: "No pathway matches that search.",
  loading: "loading…",
  loadFailed: (pathwayId, message) => `could not load ${pathwayId}.json (${message})`,
  supportedBlocks: (count) => `${count} block associations reproduced on held-out tiles`,
  bundleLabel: (bundle, collection) =>
    `${bundle.label} · ${bundle.pathways.length} ${collection} gene sets · ${bundle.patch_grid}×${bundle.patch_grid} patch grid`,

  genes: {
    noneDetected: (measured) => `none of ${measured} measured genes were detected in training tiles`,
    undetectedClause: (count) => `, ${count} never detected`,
    hint: (shown, measured, undetected) =>
      `${shown} of ${measured} measured genes${undetected}, by mean expression across training tiles (log1p CPM),`
      + " click one to map it onto the tiles",
    chipTitle: (gene) =>
      `${gene.symbol} · mean ${gene.mean} log1p CPM · sd ${gene.std} · measured on ${gene.train_slides}/46 training`
      + ` and ${gene.heldout_slides}/12 held-out slides · click to overlay its per-cell expression on the tiles`
      + " and recolour the manifold by this gene",
    overlay: (gene) => `Green squares mark <b>${gene}</b> transcripts in the cells measured inside each tile.
      Xenium reads expression once per cell, so the green layer is the per-cell expression binned onto the same
      14&times;14 grid as the block activation; patches with no measured cell stay unmarked.`,
  },

  correlation: {
    unavailable: "r unavailable",
    unavailableTitle: "Raw Pearson correlation is undefined because one input has no variance.",
    title: (pathwayName, block) =>
      `Unadjusted Pearson correlation between ${pathwayName} score and ${block.dictionary} #${block.block} activation`
      + ` magnitude across ${block.basic_r_n.toLocaleString()} training tiles. No covariate residualization; the block`
      + " card reports the adjusted effect on held-out tiles.",
  },

  scale: {
    empty: "no firing patches to scale",
    shared: (percent) => `one shared scale across these tiles, so colour means the same on each; pale end is the`
      + ` top-${percent}% cutoff, dark end the gallery peak`,
    perTile: (percent, lowest, highest) => `each tile spans its own top-${percent}% cutoff to its own peak`
      + ` (peaks ${lowest}–${highest} here), so colour is not comparable between tiles`,
    genePerTile: (gene, galleryPeak, cells) => `each tile spans 0 to its own ${gene} peak (gallery peak`
      + ` ${galleryPeak} log1p CPM per cell, ${cells} cells measured here)`,
    geneShared: (galleryPeak, cells) => `one shared scale, 0 to the gallery peak of ${galleryPeak} log1p CPM per cell`
      + ` across ${cells} measured cells`,
  },

  gallery: {
    empty: "No tiles available for this view.",
    byScore: (pathwayName, blockLabel) => `Tiles ranked by <b>${pathwayName}</b> expression score (training slides),`
      + ` the same six for every block. Blue shows where the selected block <b>${blockLabel}</b> fires.`,
    byBlock: (blockLabel, percent) => `Tiles ranked by peak patch activation of block <b>${blockLabel}</b>.`
      + ` Blue lights the strongest ${percent}% of firing patches on each tile.`,
    geneClause: (gene) => ` Green squares show <b>${gene}</b> expression in the cells measured inside each tile.`,
  },

  hover: {
    tile: (tileId, slide, tissue, split, activation) =>
      `${tileId}<br>slide ${slide} · ${tissue} · ${split}<br>block activation ${activation}`,
    block: (dictionary, block, firingFraction, dominant) =>
      `${dictionary} · block ${block}<br>firing fraction ${firingFraction}<br>dominant: ${dominant}`,
    dominantNone: "no supported pathway",
    dominantOther: "other supported pathway",
    selected: (blockLabel, firingFraction) =>
      `selected: ${blockLabel}<br>firing fraction ${firingFraction}<extra></extra>`,
  },

  // the selected block's own manifold: one point per tile
  tile: {
    missing: (blockLabel, exported) => `No tile manifold exported for ${blockLabel}. Manifolds exist for the`
      + ` ${exported} blocks that appear as cards.`,
    noScore: (pathwayId) => `No per-tile score exported for ${pathwayId}.`,
    hint: (blockLabel, tiles, groupSize) => `${blockLabel} · ${tiles} tiles where this block fires, embedded from its`
      + ` own ${groupSize} coordinates`,
    capped: (maxTiles) => ` Tiles are capped at ${maxTiles} per block, sampled proportionally across the training and`
      + " held-out splits.",

    gene: {
      title: (gene, blockLabel) => `${gene} expression inside ${blockLabel}`,
      subtitle: (gene) => `each point is one tile this block fires on, coloured by measured ${gene} counts`,
      note: (gene, groupSize, pathwayName) => `This is <b>${gene}</b> alone on the block's own manifold, so it answers
        whether the gene separates within the block: if the green tiles occupy one region, this block's ${groupSize}
        coordinates encode something ${gene} tracks. Grey tiles come from slides whose panel does not measure it. Switch
        to <b>Pathway score</b> to compare against the whole ${pathwayName} set on the same tile positions.`,
    },

    activation: {
      title: (blockLabel) => `Activation of ${blockLabel} across its tiles`,
      subtitle: "gated block norm per tile, the same quantity the tile gallery shows per patch",
      note: "Activation magnitude usually varies smoothly across the manifold, so a sharp boundary here means the"
        + " block's coordinates carry structure beyond how strongly it fires.",
    },

    tissue: {
      title: (blockLabel) => `Tissue of origin inside ${blockLabel}`,
      subtitle: (known, slides) => `${known} known tissue types across ${slides} slides; colours are fixed across blocks`,
      note: "This view shows whether the block manifold separates broad tissue types. Unknown marks two slides whose"
        + " authoritative tissue labels were unavailable; hover still shows the source slide for every tile.",
    },

    pathway: {
      title: (pathwayName, blockLabel) => `${pathwayName} score inside ${blockLabel}`,
      subtitle: (pathwayId) => `each point is one tile this block fires on, coloured by its ${pathwayId} score`,
      note: (blockLabel, groupSize, tiles) => `The pathway score is the mean training-standardized log1p-CPM expression
        of genes in the set that are measured on that tile. The cloud is the manifold of <b>${blockLabel}</b> itself: its
        ${groupSize} coordinates over the ${tiles} tiles where it fires, reduced to 3D. If the pathway score varies along
        one direction of this cloud, the block resolves that pathway internally rather than merely firing on it.`,
      geneSwitch: (gene) => ` Click <b>${gene} expression</b> to recolour the same tiles by that gene.`,
    },
  },

  // the cross-block map: one point per block
  cross: {
    hint: (blocks) => `${blocks} estimable blocks, one point each, placed by their 1,656-gene training effect signature`,
    prefix: `<b>This view is one point per block, not a block's own manifold.</b> It compares blocks by how similarly
      they respond across the 1,656 genes, so nearby points are blocks with similar gene effects. `,
    marked: (blockLabel) => ` The magenta ring and dotted stem mark <b>${blockLabel}</b>, the block selected in the
      cards above.`,
    unmarked: (blockLabel, pathwayId, blocks) => ` Nothing is ringed: <b>${blockLabel}</b> transfers on ${pathwayId} but
      is not one of the ${blocks} estimable blocks here, so it has no position in this map.`,
    markedSubtitle: (blockLabel) => `marked block ${blockLabel}`,

    layer: {
      title: "Cross-block map by encoder layer",
      subtitle: (dictionaries) => `every point is one block from one of the ${dictionaries} dictionaries, coloured by`
        + " the layer that dictionary was fit on",
      note: (dictionaries, layers) => `A block belongs to exactly one dictionary and therefore to exactly one layer, so
        this colour is a single number per point, not a range. The ${dictionaries} dictionaries were fit independently on
        layers ${layers}, each contributing 512 blocks. Layer is the dominant structure here: blocks from neighbouring
        layers land near each other.`,
    },

    gene: {
      title: (gene) => `${gene} effect across blocks`,
      subtitle: (supported) => `gene-level training partial effect per block · ${supported} associations reproduced on`
        + " held-out tiles",
      note: (gene) => `Red blocks rise with ${gene}, blue fall with it. This is one number per block, so it says which`
        + " blocks track the gene, not how the gene separates inside any one of them.",
    },

    pathway: {
      title: (pathwayName) => `${pathwayName} effect across blocks`,
      subtitle: (supported) => `training partial effect per block · ${supported} associations reproduced on held-out tiles`,
      note: "Red blocks rise with the pathway score, blue fall with it; grey-white blocks are unrelated to it.",
    },

    dominant: {
      title: (collection) => `Dominant ${collection} pathway reproduced on held-out tiles per block`,
      subtitle: (coloured, other) => `${coloured} most frequent pathways coloured, ${other} blocks dominated by another`,
      note: "Each block is coloured by the association reproduced on held-out tiles with the largest absolute effect there.",
    },
  },

  modal: {
    title: (block, tile) => `${block.dictionary} block #${block.block} on ${tile.slide_id} tile ${tile.source_h5_row}`,
    meta: (pathway, tile) => `${pathway.name} (${pathway.pathway_id}) &nbsp;·&nbsp; ${tile.tissue} &nbsp;·&nbsp;`
      + ` ${tile.split} split &nbsp;·&nbsp; <code>${tile.sequence_id}</code>`,
    stats: (block, tile, score, tokens, topPatches) => `
      effect on held-out tiles <b>${block.heldout_effect.toFixed(3)}</b> &nbsp;·&nbsp;
      effect on training tiles <b>${block.train_effect.toFixed(3)}</b> &nbsp;·&nbsp;
      &Delta;R&sup2; <b>${block.delta_r2.toFixed(4)}</b> &nbsp;·&nbsp;
      tile activity <b>${tile.activity.toFixed(3)}</b> &nbsp;·&nbsp;
      pathway score <b>${score}</b><br />
      patches firing <b>${tile.n_firing}/${tokens}</b> &nbsp;·&nbsp;
      peak patch norm <b>${tile.max_patch.toFixed(3)}</b> &nbsp;·&nbsp;
      peak : mean-firing <b>${tile.peak_to_mean.toFixed(2)}&times;</b> &nbsp;·&nbsp;
      top-5 patch norms <b>${topPatches}</b>`,
    geneCaption: (gene, stats) => `${gene} per cell, ${stats.expressing} of ${stats.occupied} measured patches,`
      + ` ${stats.cells} cells, peak ${stats.peak.toFixed(1)}<br />grey = no cell measured, pale = cell without transcript`,
  },
};
