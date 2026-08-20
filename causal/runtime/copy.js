import { CARD_LIMIT, blockNumber, decimals } from "./core.js";

// Every explanatory string stays apart from rendering so wording cannot change behaviour.
const CAUSAL_DECREASE = "Median fall in the predicted gene score when this feature's raw pre-gate coordinates on a"
  + " high-expressing tile are replaced by coordinates taken from a low-expressing donor tile. One feature is edited"
  + " at a time and everything else in the encoder is left alone, so the number is what this feature alone carries.";

const DECREASE_FRACTION = "Share of the held high-expressing tiles where the edit lowered the prediction rather than"
  + " raising it. A large median decrease that only holds on half the tiles is one or two tiles carrying the result.";

const GAP_SHARE = "The same decrease read against the gene itself: the median fall as a percentage of the observed gap"
  + " between the gene's high and low tiles. It says how much of the real spread this one feature accounts for.";

const CLUSTERING = (neighbours) => `Moran's I of the gene over the feature's own manifold, measured across each tile's`
  + ` ${neighbours} nearest neighbours there. It runs from about 0 when expression is scattered at random over the`
  + " manifold up towards 1 when tiles that agree on the gene sit together, so it says whether the feature's coordinates"
  + " actually separate the gene rather than how far the edit moved it. It is a property of the map, not of the edit,"
  + " and the two numbers are read together: a gene can cluster tightly and still barely respond to the edit.";

const CLUSTERING_ADJUSTED = "Slides differ from one another, and a feature that merely separates slides would score high"
  + " on any gene that happens to be a slide marker. The slide-adjusted figure removes each slide's own mean before"
  + " scoring, leaving only the clustering the feature resolves inside a slide; it is the stricter of the two.";

const CLUSTERING_VALUE = (entry) => (entry.clustering === null
  ? "not defined, the gene does not vary over this feature's tiles"
  : `${entry.clustering.toFixed(3)}, Moran's I over this feature's manifold, `
    + `${entry.clustering_slide_adjusted.toFixed(3)} once each slide's own mean is removed`);

const CARD_RULE = (floor) => `A card appears only when the causal decrease clears ${floor.toFixed(2)} and the upper`
  + " quartile of its per-tile deltas stays below zero, so at least three quarters of the edited tiles fell.";

const DOMINANCE = (floor) => `A gene stands out inside a feature only when its causal decrease beats the mean of the`
  + ` feature's other decreases above ${floor.toFixed(2)} by a further ${floor.toFixed(2)}. That mean is taken once per`
  + " feature, over everything but its strongest decrease, so several genes can clear it together. Those keep their"
  + " colour, the rest are greyed, and a feature whose edits single out nothing greys entirely.";

const CUTS = (limit) => `Cards are ranked by causal decrease. The list always holds the strongest ${limit} together with`
  + ` every card in colour wherever it ranks, so it can skip over cards. The control beside the heading holds back the`
  + ` greys and cuts the coloured cards to their own strongest ${limit}. The card the page is built around remains`
  + " visible either way; every other grey card is hidden.";

const SCAN = (index) => `Every number on this page comes from one exhaustive scan on slide ${index.slide}`
  + ` (${index.tissue}). All ${index.n_scanned_genes} scanned genes were tested against all 4,096 candidate features,`
  + ` and ${index.n_genes} of them carry at least one feature whose edit clears the floor. Because the scan is a single`
  + " slide, these are effects measured inside that tissue rather than effects shown to transfer to new patients.";

export const COPY = {
  loading: "loading…",
  listEmptyFeature: "No feature matches that search.",
  listEmptyGene: "No gene matches that search.",
  loadFailed: (label, message) => `could not load ${label} (${message})`,

  feature: {
    title: (number) => `Feature #${number}`,
    meta: (block, genes) => `${block.dictionary} &nbsp;·&nbsp; ${genes}${block.n_genes
      ? ` &nbsp;·&nbsp; strongest causal decrease ${block.best_effect.toFixed(decimals(block.best_effect))}` : ""}`,
    genes: (count) => `${count} gene${count === 1 ? "" : "s"} carried`,
    listGenes: (count) => `${count} gene${count === 1 ? "" : "s"}`,
    silent: "No gene's prediction falls far enough when this feature is edited, so it carries no card. Its tiles and"
      + " manifold are still here.",
    validDot: "Editing this feature singles out at least one gene, and that gene has a card here, so the feature"
      + " carries a card in colour. Features without one come after these in this order.",
    geneTitle: (entry) => `${entry.symbol} · causal decrease ${entry.causal_decrease.toFixed(decimals(entry.causal_decrease))}`
      + ` on ${Math.round(entry.decrease_fraction * 100)}% of edited tiles · ranked ${entry.scan_rank} of 4,096 candidates`
      + ` for this gene · clustering ${CLUSTERING_VALUE(entry)} · select it to colour the manifold and the tile overlays`
      + " below",
    panel: (index, catalogue) => `<span>Every card is one gene whose prediction falls when this feature is edited, and
      the gene selected here is the one the manifold colouring and the tile overlays below follow.</span>
      <span>A gene needs a causal decrease above ${index.min_effect.toFixed(2)} to earn a card, since an edit can move a
      prediction and still be too small to read. Cards are ranked by causal decrease and cut at the strongest
      ${index.genes_per_block}, which leaves ${index.n_cards.toLocaleString()} of the
      ${index.n_carried.toLocaleString()} gene-feature pairs these features admit; the greying rule still weighs all of
      them.</span>
      <span><strong>causal decrease:</strong> ${CAUSAL_DECREASE}</span>
      <span><strong>consistency:</strong> ${DECREASE_FRACTION}</span>
      <span><strong>share of gap:</strong> ${GAP_SHARE}</span>
      <span><strong>clustering:</strong> ${CLUSTERING(catalogue.clustering_neighbours)}</span>
      <span>${CLUSTERING_ADJUSTED}</span>
      <span>${CARD_RULE(index.min_effect)}</span>
      <span><strong>Greyed cards:</strong> ${DOMINANCE(index.min_effect)}</span>
      <span>${SCAN(catalogue)}</span>`,
  },

  gene: {
    meta: (entry, features) => `${features} &nbsp;·&nbsp; measured spread between its high and low tiles`
      + ` ${entry.observed_activity_gap.toFixed(3)}`,
    features: (count) => `${count} feature${count === 1 ? "" : "s"} whose edit lowers it`,
    listFeatures: (count) => `${count} ft`,
    featureTitle: (entry) => `Feature #${blockNumber(entry.layer, entry.block)} · ${entry.dictionary} · causal decrease`
      + ` ${entry.causal_decrease.toFixed(decimals(entry.causal_decrease))} on`
      + ` ${Math.round(entry.decrease_fraction * 100)}% of edited tiles · ${entry.gap_pct.toFixed(2)}% of the gene's`
      + ` measured spread · clustering ${CLUSTERING_VALUE(entry)} · select it to draw its manifold and its tiles`,
    panel: (index, catalogue) => `<span>Every card is one feature whose edit lowers this gene's prediction, and the
      feature selected here is the one the manifold and the tiles below belong to.</span>
      <span>A feature needs a causal decrease above ${index.min_effect.toFixed(2)} to earn a card. Cards are ranked by
      causal decrease and cut at the strongest ${index.genes_per_block}.</span>
      <span><strong>causal decrease:</strong> ${CAUSAL_DECREASE}</span>
      <span><strong>consistency:</strong> ${DECREASE_FRACTION}</span>
      <span><strong>share of gap:</strong> ${GAP_SHARE}</span>
      <span><strong>clustering:</strong> ${CLUSTERING(catalogue.clustering_neighbours)}</span>
      <span>${CLUSTERING_ADJUSTED}</span>
      <span>${CARD_RULE(index.min_effect)}</span>
      <span><strong>Greyed cards:</strong> ${DOMINANCE(index.min_effect)}</span>
      <span>${SCAN(catalogue)}</span>`,
  },

  head: {
    panel: (catalogue) => `<span><strong>Causal decrease:</strong> ${CAUSAL_DECREASE}</span>
      <span><strong>The blue overlay:</strong> the L2 norm of the 16-dimensional coordinate the feature assigns to each
      patch, zero wherever the feature is not among that patch's active features. It marks where on a tile the edit
      had anything to change.</span>
      <span><strong>The edit:</strong> ${catalogue.protocol}, scored in ${catalogue.expression_domain}. Coordinates are
      swapped before the top-96 gate, so the feature can leave the gate as a result of the edit.</span>
      <span>${SCAN(catalogue)}</span>`,
  },

  cards: {
    causalDecrease: CAUSAL_DECREASE,
    decreaseFraction: DECREASE_FRACTION,
    gapShare: GAP_SHARE,
    clustering: (neighbours) => `${CLUSTERING(neighbours)} ${CLUSTERING_ADJUSTED}`,
    mark: (picked) => (picked
      ? "in colour: editing this feature singles this gene out"
      : "greyed: this is not the gene editing this feature singles out"),
    foldToggle: (folded, count) => `${folded ? "show" : "hide"} ${count} more`,
    foldTitle: CUTS(CARD_LIMIT),
  },

  pair: {
    label: "selected gene × selected feature",
    title: (gene, block) => `Editing feature #${blockNumber(block.layer, block.block)} lowers the predicted ${gene}`
      + ` score by ${block.causal_decrease.toFixed(decimals(block.causal_decrease))} at the median, on`
      + ` ${Math.round(block.decrease_fraction * 100)}% of the edited tiles.`,
    none: "no admitted pair",
    noneTitle: "This feature admits no gene, so there is no causal pair to report.",
  },

  gallery: {
    empty: "No tiles available for this view.",
    basis: (shown, pool, gene, expressing) =>
      `The ${shown} highest-<b>${gene}</b> tiles among the ${pool} this feature fires hardest on, ${expressing} of`
      + ` them carrying any ${gene} at all. The edit only reaches a tile the feature fires on, so this is as close`
      + ` as the atlas gets to the high tiles the swap was applied to.`,
    provenance: (slide, onSlide, shown) => ` ${onSlide === 0
      ? `None come from ${slide}, the single slide every causal number on this page was measured on.`
      : `${onSlide} of ${shown} come from ${slide}, the single slide every causal number on this page was measured`
        + ` on, and carry its badge.`}`,
  },

  hover: {
    tile: (tileId, slide, tissue, split, activation) =>
      `${tileId}<br>slide ${slide} · ${tissue} · ${split}<br>feature norm ${activation}`,
    block: (number, strongest) => `feature #${number}<br>strongest: ${strongest}`,
    strongestNone: "no admitted gene",
    selected: (label) => `selected: ${label}<extra></extra>`,
  },

  tile: {
    missing: (label, exported) => `No tile manifold exported for ${label}. Manifolds exist for the`
      + ` ${exported} features the site lists.`,
    capped: (maxTiles) => ` Tiles are capped at ${maxTiles} per feature, sampled proportionally across the two splits.`,

    gene: {
      title: (gene) => `${gene} expression`,
      subtitle: (label) => `tiles of ${label}, coloured by measured transcript count`,
      missing: "gene not on this slide panel",
      note: (gene, label, missing) => `Each point is a tile where ${label} fires, training and held-out alike, placed by
        the coordinates the feature assigns it. Green confined to one region indicates that ${label}'s coordinates encode
        structure <b>${gene}</b> tracks.${missing ? " Grey tiles come from slides whose panel omits it." : ""} The right
        plot holds the same positions, coloured by the tissue each tile came from.`,
    },

    tissue: {
      title: "Tissue of origin",
      subtitle: (known, slides) => `${known} types across ${slides} slides, same positions`,
    },
  },

  cross: {
    prefix: `<b>Each point is one feature, not one tile.</b> Features are placed by their correlational effects across
      the 1,656 measured genes, so neighbouring points behave alike; the colour is what the edits found. `,
    marked: (label) => ` The magenta ring marks <b>${label}</b>, the feature this view is built around.`,
    unmarked: (label, blocks) => ` Nothing is ringed: <b>${label}</b> is not among the ${blocks} features mapped here.`,
    markedSubtitle: (label) => `${label} marked`,

    layer: {
      title: "Cross-feature map by encoder layer",
      subtitle: "every point is one feature, coloured by the encoder layer it was fit on",
      note: (layers) => `Each feature belongs to exactly one layer, so the colour is one value per point rather than a
        range. Layers ${layers} were fit independently, yet features from neighbouring layers land near each other.`,
    },

    causal: {
      title: (gene) => `${gene} causal decrease across features`,
      subtitle: (supported) => `one edit per feature · ${supported} clear the card floor`,
      note: (gene) => `Red features lower ${gene} when edited, blue raise it, and grey-white features barely move it.
        One value per feature, so it indicates which features carry the gene, not how the gene varies within any one of
        them.`,
      missing: (gene) => `No causal colouring exported for ${gene}.`,
    },
  },

  modal: {
    title: (block, tile) => `Feature #${blockNumber(block.layer, block.block)} on ${tile.slide_id} tile ${tile.source_h5_row}`,
    meta: (gene, tile) => `${gene} &nbsp;·&nbsp; ${tile.tissue} &nbsp;·&nbsp; ${tile.split} split &nbsp;·&nbsp;`
      + ` <code>${tile.sequence_id}</code>`,
    stats: (card, tile, tokens, topPatches) => `
      causal decrease <b>${card ? card.causal_decrease.toFixed(decimals(card.causal_decrease)) : "n/a"}</b> &nbsp;·&nbsp;
      consistency <b>${card ? `${Math.round(card.decrease_fraction * 100)}%` : "n/a"}</b> &nbsp;·&nbsp;
      share of gap <b>${card ? `${card.gap_pct.toFixed(2)}%` : "n/a"}</b> &nbsp;·&nbsp;
      tile norm <b>${tile.activity.toFixed(3)}</b><br />
      patches firing <b>${tile.n_firing}/${tokens}</b> &nbsp;·&nbsp;
      peak patch norm <b>${tile.max_patch.toFixed(3)}</b> &nbsp;·&nbsp;
      peak : mean-firing <b>${tile.peak_to_mean.toFixed(2)}&times;</b> &nbsp;·&nbsp;
      top-5 patch norms <b>${topPatches}</b>`,
    overlayCaption: (fraction) => (fraction >= 1 ? "feature norm over H&amp;E, every firing patch"
      : `feature norm over H&amp;E, strongest ${Math.round(fraction * 100)}% of firing patches`),
    heatCaption: (patches) => `feature norm, all ${patches} patches`,
    geneCaption: (gene, stats) => `${gene} log1p CPM, mean over each patch's cells<br />`
      + `${stats.expressing}/${stats.occupied} patches with cells express it, peak ${stats.peak.toFixed(1)}, ${stats.cells} cells`
      + "<br />grey = no cell measured, pale = cell without transcript",
  },
};
