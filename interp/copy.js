"use strict";

// Every explanatory string the explorer shows, kept apart from the rendering logic so wording
// can change without touching behaviour. Values are plain strings or functions of the numbers
// they quote. Short control labels stay in app.js next to the widgets they belong to.
// The data calls a feature a block, so the identifiers below keep that name while the prose does not.

// each card metric is written once, then shown both as a row tooltip and inside the card's own panel
const FEATURE_HELDOUT_R = "Partial correlation between the pathway score and this feature's tile norm on the 12"
  + " unseen slides, averaged over patients, with the covariate coefficients carried over from training. Eight"
  + " covariates are removed from both sides: colour, tissue occupancy, cell count and library size.";

const FEATURE_TRAIN_R = "The same partial correlation fit on the tiles of the 46 training slides.";

const FEATURE_DELTA_R2 = "What the feature adds beyond those covariates on slides it never saw: the held-out variance"
  + " in the pathway score explained by a covariates-plus-feature model minus a covariates-only model, both fit on"
  + " training tiles. 0.15 means the feature accounts for a further 15% of the score's variance.";

const FEATURE_RULE = "A card appears only when held-out r agrees in sign with training r, its patient-level bootstrap"
  + " interval excludes zero, and \u0394R\u00B2 is positive.";

// the greying rule, which is one relation between a feature and a set read from either side
const FEATURE_DOMINANCE = "A feature points at a set only when its strongest |held-out r| beats the mean of the"
  + " feature's other effects above 0.10 by a further 0.10, weighed over every set the feature reproduces. That set"
  + " keeps its colour, the rest are greyed, and a feature whose evidence singles out nothing greys entirely.";

// the rule is read over every feature scored, while the site only holds the ones worth browsing
const FEATURE_UNLISTED = "A feature is credited with the set it points at only where the site lists the feature at"
  + " all, and one firing on too few tiles to draw a manifold is left out.";

const COPY = {
  sidebarEmpty: "No pathway matches that search.",
  loading: "loading…",
  loadFailed: (pathwayId, message) => `could not load ${pathwayId}.json (${message})`,
  supportedBlocks: (count) => `${count} feature associations reproduced on held-out tiles`,

  // the same evidence read from the feature's side: one feature, every gene set it carries
  byBlock: {
    listEmpty: "No feature matches that search.",
    title: (number) => `Feature #${number}`,
    meta: (block, sets) => `${block.dictionary} &nbsp;·&nbsp; ${sets} &nbsp;·&nbsp; strongest held-out r`
      + ` ${signed(block.best_effect)}`,
    sets: (count) => `${count} gene set${count === 1 ? "" : "s"} carried`,
    listSets: (count) => `${count} set${count === 1 ? "" : "s"}`,
    validDot: "The held-out evidence singles out one of this feature's sets and that set has a card here, so one of"
      + " its cards is in colour. Features without one come after these in this order.",
    panel: (index) => `<span>Every card is one gene set this feature reproduces on held-out tissue, and the set selected
      here is the one the genes, the manifold colouring and the tile overlays below follow.</span>
      <span>A set needs |held-out r| above ${index.min_effect.toFixed(2)} to earn a card, since an effect can
      reproduce and still be too small to read, and the ${index.n_blocks} features on the left clear the same floor.
      Cards are ranked by |held-out r| and cut at the strongest ${index.sets_per_block}, which leaves
      ${index.n_cards.toLocaleString()} of the ${index.n_carried.toLocaleString()} associations these features
      reproduce; the greying rule still weighs all of them. Every card here is exported in full, so any of them
      can be selected, greyed or not.</span>
      <span><strong>held-out r:</strong> ${FEATURE_HELDOUT_R}</span>
      <span><strong>training r:</strong> ${FEATURE_TRAIN_R}</span>
      <span><strong>&Delta;R&sup2; held-out:</strong> ${FEATURE_DELTA_R2}</span>
      <span>${FEATURE_RULE}</span>
      <span><strong>Greyed cards:</strong> ${FEATURE_DOMINANCE}</span>`,
    setTitle: (entry) => `${entry.collection_label} · ${entry.name} (${entry.pathway_id})`
      + (entry.drawable
        ? ` · ${entry.n_scored_genes} of its genes scored inside this feature · select it to colour the genes, the`
          + " manifold and the tiles by this set"
        : ""),
  },

  genes: {
    chipTitle: (gene, blockLabel) =>
      `${gene.symbol} · clustering ${gene.clustering}, Moran's I over the ${gene.n_tiles} tiles of ${blockLabel} where it`
      + ` is measured · ${gene.clustering_slide_adjusted} once each slide's own mean is removed · ${gene.activation_r >= 0
        ? "rises" : "falls"} with the feature norm, r ${gene.activation_r} · detected in`
      + ` ${Math.round(gene.detection * 100)}% of those tiles · mean ${gene.mean} log1p CPM, sd ${gene.std} · measured on`
      + ` ${gene.train_slides}/46 training and ${gene.heldout_slides}/12 held-out slides · click to overlay its per-cell`
      + " expression on the tiles and recolour the manifold by this gene",
    viaSet: (name) => ` · reached through ${name}, the set that scores it here`,
    clusteringLabel: "I: Moran's I of the gene over this feature's manifold, high when tiles that agree on the gene"
      + " sit together. The cards are ranked by it.",
    activationLabel: "r: Pearson correlation between the gene's expression and the feature norm over the same tiles."
      + " A gene can cluster tightly and still barely track the norm, so the two numbers are read together.",
  },

  blocks: {
    heldoutR: FEATURE_HELDOUT_R,
    trainR: FEATURE_TRAIN_R,
    deltaR2: FEATURE_DELTA_R2,
    mark: (picked) => (picked
      ? "in colour: this feature's held-out evidence points at this set"
      : "greyed: this is not the set this feature's held-out evidence points at"),
    inert: "listed for weight only: this build did not export the set in full, so it has no tiles, genes or"
      + " colouring to open",
    moreToggle: (shown, count) => `${shown ? "hide" : "show"} ${count} greyed`,
    moreTitle: "The list is drawn down to the strongest few and then to every card the rule kept in colour, however"
      + " far down it sits. What that leaves out is greyed, and it waits here. The selected card is always drawn,"
      + " since the genes, the manifold and the tiles below follow it.",
    panel: (dominance) => `<span><strong>held-out r:</strong> ${FEATURE_HELDOUT_R}</span>
      <span><strong>training r:</strong> ${FEATURE_TRAIN_R}</span>
      <span><strong>&Delta;R&sup2; held-out:</strong> ${FEATURE_DELTA_R2}</span>
      <span>${FEATURE_RULE}</span>
      <span><strong>Greyed cards:</strong> ${FEATURE_DOMINANCE} A set with no card in colour here is one no feature
      resolves on its own.</span>
      <span>${FEATURE_UNLISTED} ${dominance.n_margin.toLocaleString()} of the
      ${dominance.n_blocks_scored.toLocaleString()} features that reproduce anything single out a set, and
      ${dominance.n_dominant} of those are features the site lists.</span>`,
  },

  correlation: {
    unavailable: "r unavailable",
    unavailableTitle: "Raw Pearson correlation is undefined because one input has no variance.",
    title: (pathwayName, block) =>
      `Unadjusted Pearson correlation between ${pathwayName} score and the tile norm of feature`
      + ` #${blockNumber(block.layer, block.block)}`
      + ` across ${block.basic_r_n.toLocaleString()} training tiles. No covariates are residualized; the card reports the`
      + " adjusted held-out r.",
  },

  gallery: {
    empty: "No tiles available for this view.",
  },

  hover: {
    tile: (tileId, slide, tissue, split, activation) =>
      `${tileId}<br>slide ${slide} · ${tissue} · ${split}<br>feature norm ${activation}`,
    block: (blockNumber, strongest) => `feature #${blockNumber}<br>strongest: ${strongest}`,
    strongestNone: "no reproduced pathway",
    strongestOther: "another reproduced pathway",
    selected: (blockLabel) => `selected: ${blockLabel}<extra></extra>`,
  },

  // the selected feature's own manifold: one point per tile
  tile: {
    missing: (blockLabel, exported) => `No tile manifold exported for ${blockLabel}. Manifolds exist for the`
      + ` ${exported} features that appear as cards.`,
    noScore: (pathwayId) => `No per-tile score exported for ${pathwayId}.`,
    capped: (maxTiles) => ` Tiles are capped at ${maxTiles} per feature, sampled proportionally across the two splits.`,

    gene: {
      title: (gene) => `${gene} expression`,
      subtitle: (blockLabel) => `tiles of ${blockLabel}, coloured by mean log1p CPM`,
      missing: "gene not on this slide panel",
      note: (gene, pathwayName) => `Green tiles confined to one region indicate that the feature's coordinates encode
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
      note: (tiles) => `Each point is one of the ${tiles} tiles where this feature fires, training and held-out alike;
        held-out tiles are scored with the standardization frozen on the training slides. Both plots hold the same
        positions and rotate independently, the left coloured by the pathway score and the right by the tissue the tile
        came from; score varying along a direction the tissues do not follow indicates the feature resolves the pathway
        internally rather than tracking tissue identity.`,
      geneSwitch: (gene) => ` Select <b>${gene} expression</b> to recolour the same tiles by that gene.`,
    },
  },

  // the cross-feature map: one point per feature
  cross: {
    prefix: `<b>Each point is one feature, not one tile.</b> Features are compared by their effects across the 1,656
      measured genes, so neighbouring points have similar gene effects. `,
    marked: (blockLabel, where) => ` The magenta ring marks <b>${blockLabel}</b>, ${where}.`,
    where: { pathway: "selected in the cards above", block: "the feature this view is built around" },
    unmarked: (blockLabel, pathwayId, blocks) => ` Nothing is ringed: <b>${blockLabel}</b> transfers on ${pathwayId} but
      is not among the ${blocks} estimable features mapped here.`,
    markedSubtitle: (blockLabel) => `${blockLabel} marked`,

    layer: {
      title: "Cross-feature map by encoder layer",
      subtitle: "every point is one feature, coloured by the encoder layer it was fit on",
      note: (layers) => `Each feature belongs to exactly one layer, so the colour is one value per point rather than a
        range. Layers ${layers} were fit independently, yet features from neighbouring layers land near each other.`,
    },

    gene: {
      title: (gene) => `${gene} effect across features`,
      subtitle: (supported) => `gene-level training partial effect per feature · ${supported} associations reproduced on`
        + " held-out tiles",
      note: (gene) => `Red features rise with ${gene}, blue fall with it. One value per feature, so it indicates which`
        + " features track the gene, not how the gene separates within any one of them.",
    },

    pathway: {
      title: (pathwayName) => `${pathwayName} effect across features`,
      subtitle: (supported) => `training partial effect per feature · ${supported} associations reproduced on held-out`
        + " tiles",
      note: "Red features rise with the pathway score, blue fall with it; grey-white features are unrelated to it.",
    },

    strongest: {
      title: (collection) => `Strongest ${collection} pathway reproduced on held-out tiles per feature`,
      subtitle: (coloured, other) => `${coloured} most frequent pathways coloured, ${other} features led by another`,
      note: "Each feature is coloured by the association reproduced on held-out tiles with the largest absolute effect"
        + " there. This is the feature's leader rather than the set it points at, since no margin is required: a feature"
        + " whose top few effects sit together is coloured by whichever of them came first and is greyed on the cards.",
    },
  },

  modal: {
    title: (block, tile) => `Feature #${blockNumber(block.layer, block.block)} on ${tile.slide_id} tile ${tile.source_h5_row}`,
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
    overlayCaption: (fraction) => (fraction >= 1 ? "feature norm over H&amp;E, every firing patch"
      : `feature norm over H&amp;E, strongest ${Math.round(fraction * 100)}% of firing patches`),
    heatCaption: (patches) => `feature norm, all ${patches} patches`,
    geneCaption: (gene, stats) => `${gene} log1p CPM, mean over each patch's cells<br />`
      + `${stats.expressing}/${stats.occupied} patches with cells express it, peak ${stats.peak.toFixed(1)}, ${stats.cells} cells`
      + "<br />grey = no cell measured, pale = cell without transcript",
  },
};
