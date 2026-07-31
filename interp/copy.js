"use strict";

// Every explanatory string the explorer shows, kept apart from the rendering logic so wording
// can change without touching behaviour. Values are plain strings or functions of the numbers
// they quote. Short control labels stay in app.js next to the widgets they belong to.

const COPY = {
  sidebarEmpty: "No pathway matches that search.",
  loading: "loading…",
  loadFailed: (pathwayId, message) => `could not load ${pathwayId}.json (${message})`,
  supportedBlocks: (count) => `${count} block associations reproduced on held-out tiles`,

  genes: {
    chipTitle: (gene, blockLabel) =>
      `${gene.symbol} · clustering ${gene.clustering}, Moran's I over the ${gene.n_tiles} tiles of ${blockLabel} where it`
      + ` is measured · ${gene.clustering_slide_adjusted} once each slide's own mean is removed · ${gene.activation_r >= 0
        ? "rises" : "falls"} with block activation, r ${gene.activation_r} · detected in`
      + ` ${Math.round(gene.detection * 100)}% of those tiles · mean ${gene.mean} log1p CPM, sd ${gene.std} · measured on`
      + ` ${gene.train_slides}/46 training and ${gene.heldout_slides}/12 held-out slides · click to overlay its per-cell`
      + " expression on the tiles and recolour the manifold by this gene",
  },

  blocks: {
    heldoutR: "Partial correlation between the pathway score and this block's activation magnitude on the 12 unseen"
      + " slides, averaged over patients, with the covariate coefficients carried over from training.",
    trainR: "The same partial correlation fit on the tiles of the 46 training slides.",
    deltaR2: "Held-out variance in the pathway score explained by adding this block's activity to a covariates-only"
      + " model, with every coefficient fit on training tiles.",
    firing: "Fraction of tiles on which this block is active at all.",
  },

  correlation: {
    unavailable: "r unavailable",
    unavailableTitle: "Raw Pearson correlation is undefined because one input has no variance.",
    title: (pathwayName, block) =>
      `Unadjusted Pearson correlation between ${pathwayName} score and the activation magnitude of block #${block.block}`
      + ` across ${block.basic_r_n.toLocaleString()} training tiles. No covariates are residualized; the card reports the`
      + " adjusted held-out r.",
  },

  gallery: {
    empty: "No tiles available for this view.",
  },

  hover: {
    tile: (tileId, slide, tissue, split, activation) =>
      `${tileId}<br>slide ${slide} · ${tissue} · ${split}<br>block activation ${activation}`,
    block: (block, firingFraction, dominant) =>
      `block ${block}<br>firing fraction ${firingFraction}<br>dominant: ${dominant}`,
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
    capped: (maxTiles) => ` Tiles are capped at ${maxTiles} per block, sampled proportionally across the two splits.`,

    gene: {
      title: (gene) => `${gene} expression`,
      subtitle: (blockLabel) => `tiles of ${blockLabel}, coloured by measured counts`,
      note: (gene, pathwayName) => `Green tiles confined to one region indicate that the block's coordinates encode
        structure <b>${gene}</b> tracks. Grey tiles come from slides whose panel omits it. Select <b>Pathway score</b> to
        compare the full ${pathwayName} set on the same positions.`,
    },

    tissue: {
      title: "Tissue of origin",
      subtitle: (known, slides) => `${known} types across ${slides} slides, same positions`,
    },

    pathway: {
      title: (pathwayName) => `${pathwayName} score`,
      subtitle: (blockLabel, pathwayId) => `tiles of ${blockLabel}, coloured by ${pathwayId} score`,
      note: (tiles) => `Each point is one of the ${tiles} tiles where this block fires. Both plots hold the same
        positions and rotate independently, the left coloured by the pathway score and the right by the tissue the tile
        came from; score varying along a direction the tissues do not follow indicates the block resolves the pathway
        internally rather than tracking tissue identity.`,
      geneSwitch: (gene) => ` Select <b>${gene} expression</b> to recolour the same tiles by that gene.`,
    },
  },

  // the cross-block map: one point per block
  cross: {
    prefix: `<b>Each point is one block, not one tile.</b> Blocks are compared by their effects across the 1,656 measured
      genes, so neighbouring points have similar gene effects. `,
    marked: (blockLabel) => ` The magenta ring marks <b>${blockLabel}</b>, selected in the cards above.`,
    unmarked: (blockLabel, pathwayId, blocks) => ` Nothing is ringed: <b>${blockLabel}</b> transfers on ${pathwayId} but
      is not among the ${blocks} estimable blocks mapped here.`,
    markedSubtitle: (blockLabel) => `${blockLabel} marked`,

    layer: {
      title: "Cross-block map by encoder layer",
      subtitle: "every point is one block, coloured by the encoder layer it was fit on",
      note: (layers) => `Each block belongs to exactly one layer, so the colour is one value per point rather than a range.
        Layers ${layers} were fit independently, yet blocks from neighbouring layers land near each other.`,
    },

    gene: {
      title: (gene) => `${gene} effect across blocks`,
      subtitle: (supported) => `gene-level training partial effect per block · ${supported} associations reproduced on`
        + " held-out tiles",
      note: (gene) => `Red blocks rise with ${gene}, blue fall with it. One value per block, so it indicates which blocks`
        + " track the gene, not how the gene separates within any one of them.",
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
    title: (block, tile) => `Block #${block.block} on ${tile.slide_id} tile ${tile.source_h5_row}`,
    meta: (pathway, tile) => `${pathway.name} (${pathway.pathway_id}) &nbsp;·&nbsp; ${tile.tissue} &nbsp;·&nbsp;`
      + ` ${tile.split} split &nbsp;·&nbsp; <code>${tile.sequence_id}</code>`,
    stats: (block, tile, score, tokens, topPatches) => `
      held-out r <b>${block.heldout_effect.toFixed(3)}</b> &nbsp;·&nbsp;
      training r <b>${block.train_effect.toFixed(3)}</b> &nbsp;·&nbsp;
      &Delta;R&sup2; held-out <b>${block.delta_r2.toFixed(4)}</b> &nbsp;·&nbsp;
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
