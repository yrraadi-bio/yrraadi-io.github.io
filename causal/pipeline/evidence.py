"""Select causally supported gene-feature pairs and apply the site's card and dominance rules."""

import pandas as pd

from pipeline.config import CARDS_PER_TARGET, MIN_EFFECT, global_index

COLUMNS = ["gene", "target_index", "layer", "block", "rank", "causal_decrease_score", "median_target_delta",
           "target_delta_q25", "target_delta_q75", "decrease_fraction", "observed_activity_gap", "slide", "tissue",
           "causal_decrease_gap_pct"]


def load_rankings(path):

    """Read the causal scan and key every pair by the site's feature identifier.

    Args:
        path (Path): Per-gene ranking parquet written by the causal block scan.

    Returns:
        pandas.DataFrame: Gene-feature rows carrying ``block_global_index``.
    """

    frame = pd.read_parquet(path, columns=COLUMNS)
    frame["block_global_index"] = [global_index(layer, block) for layer, block in zip(frame["layer"], frame["block"])]

    return frame


def ranked(effects):

    """Rank cardable pairs by causal decrease.

    A pair is cardable when its decrease clears the floor and its upper delta quartile stays
    below zero, so at least three quarters of the held tiles fell.

    Args:
        effects (pandas.DataFrame): Gene-feature rows from ``load_rankings``.

    Returns:
        pandas.DataFrame: Admitted rows in stable descending order of ``magnitude``.
    """

    strong = effects[(effects["causal_decrease_score"] > MIN_EFFECT) & (effects["target_delta_q75"] < 0)]

    return strong.assign(magnitude=strong["causal_decrease_score"]).sort_values("magnitude", ascending=False, kind="stable")


def effects(row):

    """Reduce one admitted row to the numbers every card shows.

    Args:
        row (pandas.NamedTuple): Admitted row from ``ranked``.

    Returns:
        dict: Causal decrease, consistency, and activity-gap share.
    """

    return {
        "causal_decrease": round(float(row.causal_decrease_score), 5),
        "decrease_fraction": round(float(row.decrease_fraction), 4),
        "gap_pct": round(float(row.causal_decrease_gap_pct), 4),
        "median_delta": round(float(row.median_target_delta), 5),
        "delta_q25": round(float(row.target_delta_q25), 5),
        "delta_q75": round(float(row.target_delta_q75), 5),
        "scan_rank": int(row.rank),
    }


def leaders(effects):

    """Name each feature's strongest-scoring gene whether or not it clears the floor.

    Every feature needs one gene to colour its manifold and order its tiles, including the
    features whose evidence never reaches the card floor.

    Args:
        effects (pandas.DataFrame): Gene-feature rows from ``load_rankings``.

    Returns:
        dict: Block global index to its strongest-scoring gene symbol.
    """

    ordered = effects.sort_values("causal_decrease_score", ascending=False, kind="stable")

    return {int(index): group.iloc[0]["gene"] for index, group in ordered.groupby("block_global_index", sort=False)}


def carded(rows):

    """Name every gene-feature pair the feature-first view shows.

    Args:
        rows (pandas.DataFrame): Admitted rows from ``ranked``.

    Returns:
        dict: Gene symbol to the block global indices carding it.
    """

    pairs = {}

    for index, group in rows.groupby("block_global_index", sort=False):
        for row in group.head(CARDS_PER_TARGET).itertuples(index=False):
            pairs.setdefault(row.gene, set()).add(int(index))

    return pairs


def winners(rows):

    """Pick the genes that stand clear of each feature's evidence tail.

    The margin is the floor plus the mean decrease of everything but the feature's strongest
    gene, matching the rule the pathway explorer applies to held-out correlations.

    Args:
        rows (pandas.DataFrame): Admitted rows from ``ranked``.

    Returns:
        dict: Block global index to the gene symbols that clear its margin.
    """

    picks = {}

    for index, group in rows.groupby("block_global_index", sort=False):
        magnitudes = group["magnitude"].to_numpy()
        margin = MIN_EFFECT + (magnitudes[1:].mean() if len(magnitudes) > 1 else 0.0)
        clear = group[group["magnitude"] > margin]

        if len(clear):
            picks[int(index)] = [row.gene for row in clear.itertuples(index=False)]

    return picks
