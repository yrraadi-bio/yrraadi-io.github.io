"use strict";

// Every explanatory string the explorer shows, kept apart from the rendering logic so wording
// can change without touching behaviour. Values are plain strings or functions of the numbers
// they quote. Short control labels stay in app.js next to the widgets they belong to.

// each card metric is written once, then shown both as a row tooltip and inside the card's own panel
const BLOCK_HELDOUT_R = "Partial correlation between the pathway score and this block's tile norm on the 12"
  + " unseen slides, averaged over patients, with the covariate coefficients carried over from training. Eight"
  + " covariates are removed from both sides: colour, tissue occupancy, cell count and library size.";

const BLOCK_TRAIN_R = "The same partial correlation fit on the tiles of the 46 training slides.";

const BLOCK_DELTA_R2 = "What the block adds beyond those covariates on slides it never saw: the held-out variance in the"
  + " pathway score explained by a covariates-plus-block model minus a covariates-only model, both fit on training"
  + " tiles. 0.15 means the block accounts for a further 15% of the score's variance.";

const BLOCK_RULE = "A card appears only when held-out r agrees in sign with training r, its patient-level bootstrap"
  + " interval excludes zero, and \u0394R\u00B2 is positive.";

// the greying rule, which is one relation between a block and a set read from either side
const BLOCK_DOMINANCE = "A block points at a set only when its strongest |held-out r| beats the mean of the block's"
  + " other effects above 0.10 by a further 0.10, measured over every set the block reproduces rather than the few"
  + " shown here. That set keeps its colour, the rest are greyed, and a block whose evidence singles out nothing"
  + " greys entirely.";

// what the rule cannot show, which is most of what it finds
const BLOCK_UNEXPORTED = "The set a block points at is credited only where it has a card on that block, since a set"
  + " with no card has no tiles, genes or colouring to stand on. Crediting the runner-up instead would name a set the"
  + " evidence did not pick, so those blocks stay grey.";

const COPY = {
  sidebarEmpty: "No pathway matches that search.",
  loading: "loading…",
  loadFailed: (pathwayId, message) => `could not load ${pathwayId}.json (${message})`,
  supportedBlocks: (count) => `${count} block associations reproduced on held-out tiles`,

  // the same evidence read from the block's side: one block, every gene set it carries
  byBlock: {
    listEmpty: "No block matches that search.",
    title: (number) => `Block #${number}`,
    meta: (block, sets) => `${block.dictionary} &nbsp;·&nbsp; ${sets} &nbsp;·&nbsp; strongest held-out r`
      + ` ${signed(block.best_effect)}`,
    sets: (count) => `${count} gene set${count === 1 ? "" : "s"} carried`,
    listSets: (count) => `${count} set${count === 1 ? "" : "s"}`,
    validDot: "The held-out evidence singles out one of this block's sets and that set has a card here, so one of"
      + " its cards is in colour. Blocks without one come after these in this order.",
    panel: (index) => `<span>Every card is one gene set this block reproduces on held-out tissue, and the set selected
      here is the one the genes, the manifold colouring and the tile overlays below follow.</span>
      <span>Cards are ranked by |held-out r| and cut at the strongest ${index.sets_per_block}; the list on the left holds
      the ${index.n_blocks} blocks that reproduce something at |r| ${index.min_effect.toFixed(2)} or above.</span>
      <span><strong>held-out r:</strong> ${BLOCK_HELDOUT_R}</span>
      <span><strong>training r:</strong> ${BLOCK_TRAIN_R}</span>
      <span><strong>&Delta;R&sup2; held-out:</strong> ${BLOCK_DELTA_R2}</span>
      <span>${BLOCK_RULE}</span>
      <span><strong>Greyed cards:</strong> ${BLOCK_DOMINANCE} ${BLOCK_UNEXPORTED}</span>`,
    setTitle: (entry) => `${entry.collection_label} · ${entry.name} (${entry.pathway_id}) · ${entry.n_scored_genes} of its`
      + " genes scored inside this block · select it to colour the genes, the manifold and the tiles by this set",
  },

  genes: {
    chipTitle: (gene, blockLabel) =>
      `${gene.symbol} · clustering ${gene.clustering}, Moran's I over the ${gene.n_tiles} tiles of ${blockLabel} where it`
      + ` is measured · ${gene.clustering_slide_adjusted} once each slide's own mean is removed · ${gene.activation_r >= 0
        ? "rises" : "falls"} with the block norm, r ${gene.activation_r} · detected in`
      + ` ${Math.round(gene.detection * 100)}% of those tiles · mean ${gene.mean} log1p CPM, sd ${gene.std} · measured on`
      + ` ${gene.train_slides}/46 training and ${gene.heldout_slides}/12 held-out slides · click to overlay its per-cell`
      + " expression on the tiles and recolour the manifold by this gene",
    viaSet: (name) => ` · reached through ${name}, the set that scores it here`,
  },

  blocks: {
    heldoutR: BLOCK_HELDOUT_R,
    trainR: BLOCK_TRAIN_R,
    deltaR2: BLOCK_DELTA_R2,
    mark: (picked) => (picked
      ? "in colour: this block's held-out evidence points at this set"
      : "greyed: this is not the set this block's held-out evidence points at"),
    panel: (dominance) => `<span><strong>held-out r:</strong> ${BLOCK_HELDOUT_R}</span>
      <span><strong>training r:</strong> ${BLOCK_TRAIN_R}</span>
      <span><strong>&Delta;R&sup2; held-out:</strong> ${BLOCK_DELTA_R2}</span>
      <span>${BLOCK_RULE}</span>
      <span><strong>Greyed cards:</strong> ${BLOCK_DOMINANCE} A set with no card in colour here is one no block
      resolves on its own.</span>
      <span>${BLOCK_UNEXPORTED} ${dominance.n_margin.toLocaleString()} of the
      ${dominance.n_blocks_scored.toLocaleString()} blocks that reproduce anything single out a set, and
      ${dominance.n_dominant} of those onto a set this build exported.</span>`,
  },

  correlation: {
    unavailable: "r unavailable",
    unavailableTitle: "Raw Pearson correlation is undefined because one input has no variance.",
    title: (pathwayName, block) =>
      `Unadjusted Pearson correlation between ${pathwayName} score and the tile norm of block`
      + ` #${blockNumber(block.layer, block.block)}`
      + ` across ${block.basic_r_n.toLocaleString()} training tiles. No covariates are residualized; the card reports the`
      + " adjusted held-out r.",
  },

  gallery: {
    empty: "No tiles available for this view.",
  },

  hover: {
    tile: (tileId, slide, tissue, split, activation) =>
      `${tileId}<br>slide ${slide} · ${tissue} · ${split}<br>block norm ${activation}`,
    block: (blockNumber, dominant) => `block #${blockNumber}<br>dominant: ${dominant}`,
    dominantNone: "no supported pathway",
    dominantOther: "other supported pathway",
    selected: (blockLabel) => `selected: ${blockLabel}<extra></extra>`,
  },

  // the selected block's own manifold: one point per tile
  tile: {
    missing: (blockLabel, exported) => `No tile manifold exported for ${blockLabel}. Manifolds exist for the`
      + ` ${exported} blocks that appear as cards.`,
    noScore: (pathwayId) => `No per-tile score exported for ${pathwayId}.`,
    capped: (maxTiles) => ` Tiles are capped at ${maxTiles} per block, sampled proportionally across the two splits.`,

    gene: {
      title: (gene) => `${gene} expression`,
      subtitle: (blockLabel) => `tiles of ${blockLabel}, coloured by mean log1p CPM`,
      missing: "gene not on this slide panel",
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
      missing: "fewer than three pathway genes on this slide panel",
      note: (tiles) => `Each point is one of the ${tiles} tiles where this block fires, training and held-out alike;
        held-out tiles are scored with the standardization frozen on the training slides. Both plots hold the same
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
    marked: (blockLabel, where) => ` The magenta ring marks <b>${blockLabel}</b>, ${where}.`,
    where: { pathway: "selected in the cards above", block: "the block this view is built around" },
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
    title: (block, tile) => `Block #${blockNumber(block.layer, block.block)} on ${tile.slide_id} tile ${tile.source_h5_row}`,
    meta: (pathway, tile) => `${pathway.name} (${pathway.pathway_id}) &nbsp;·&nbsp; ${tile.tissue} &nbsp;·&nbsp;`
      + ` ${tile.split} split &nbsp;·&nbsp; <code>${tile.sequence_id}</code>`,
    stats: (block, tile, score, tokens, topPatches) => `
      held-out r <b>${block.heldout_effect.toFixed(3)}</b> &nbsp;·&nbsp;
      training r <b>${block.train_effect.toFixed(3)}</b> &nbsp;·&nbsp;
      &Delta;R&sup2; held-out <b>${block.delta_r2.toFixed(4)}</b> &nbsp;·&nbsp;
      tile norm <b>${tile.activity.toFixed(3)}</b> &nbsp;·&nbsp;
      pathway score <b>${score}</b><br />
      patches firing <b>${tile.n_firing}/${tokens}</b> &nbsp;·&nbsp;
      peak patch norm <b>${tile.max_patch.toFixed(3)}</b> &nbsp;·&nbsp;
      peak : mean-firing <b>${tile.peak_to_mean.toFixed(2)}&times;</b> &nbsp;·&nbsp;
      top-5 patch norms <b>${topPatches}</b>`,

    // the overlay follows the highlight control, so its caption states the band it is showing
    overlayCaption: (fraction) => (fraction >= 1 ? "block norm over H&amp;E, every firing patch"
      : `block norm over H&amp;E, strongest ${Math.round(fraction * 100)}% of firing patches`),
    heatCaption: (patches) => `block norm, all ${patches} patches`,
    geneCaption: (gene, stats) => `${gene} log1p CPM, mean over each patch's cells<br />`
      + `${stats.expressing}/${stats.occupied} patches with cells express it, peak ${stats.peak.toFixed(1)}, ${stats.cells} cells`
      + "<br />grey = no cell measured, pale = cell without transcript",
  },
};
