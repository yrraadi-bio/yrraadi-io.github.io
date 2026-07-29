"""Render the SOD2 dispersion figure for the preprint: spatial maps + dispersion boxplots."""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.gridspec import GridSpec
from scipy.stats import mannwhitneyu

FIG_DIR = Path(__file__).resolve().parent / "figures"
RUN_DIR = Path(
    "/home/viraj/origin_astra_downstream/runs/her2_trastuzumab/"
    "hest_origin_59slide_gigapath_presence_dim1536_swiglu_rms_qknorm_4L_g1656_"
    "msepcc_depthnorm_expr100_12ep_big47_checkpoint6_yale_response"
)
GENE_AXIS = Path(
    "/home/viraj/origin_astra_downstream/models/"
    "hest_origin_59slide_gigapath_presence_dim1536_swiglu_rms_qknorm_4L_g1656_"
    "msepcc_depthnorm_expr100_12ep_big47/gene_axis_map.csv"
)

plt.rcParams.update({
    "font.family": "serif",
    "font.size": 10,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "figure.dpi": 200,
})


def load_sod2():
    genes = pd.read_csv(GENE_AXIS).sort_values("axis_index")["gene_name"].astype(str).tolist()
    sod2 = genes.index("SOD2")
    records = []
    for path in sorted((RUN_DIR / "tile_bags").glob("*.npz")):
        with np.load(path, allow_pickle=False) as bag:
            expression = np.log1p(np.clip(bag["expr"][:, sod2].astype(np.float32), 0, None))
            xy = bag["xy"].astype(np.float32)
            response = int(bag["label"])
        p50, p90 = np.percentile(expression, [50, 90])
        records.append({
            "patient_id": path.stem,
            "response": response,
            "std": float(expression.std()),
            "gap": float(p90 - p50),
            "xy": xy,
            "expression": expression,
        })
    return pd.DataFrame(records)


def pick_examples(frame, response, n=3):
    group = frame[frame["response"] == response].sort_values("gap").reset_index(drop=True)
    quantiles = np.linspace(0.15, 0.85, n)
    indices = [round(q * (len(group) - 1)) for q in quantiles]
    return group.iloc[indices].reset_index(drop=True)


def main():
    frame = load_sod2()
    responders = pick_examples(frame, 1)
    nonresponders = pick_examples(frame, 0)
    pooled = np.concatenate([np.concatenate(responders["expression"].tolist()),
                             np.concatenate(nonresponders["expression"].tolist())])
    color_min, color_max = np.percentile(pooled, [2, 98])

    figure = plt.figure(figsize=(12.0, 6.4))
    grid = GridSpec(2, 6, figure=figure, width_ratios=[1, 1, 1, 0.08, 0.22, 1.15], wspace=0.25, hspace=0.2)

    scatter = None
    map_axes = []
    for row, (label, examples) in enumerate([("Responder", responders), ("Non-responder", nonresponders)]):
        for column in range(3):
            record = examples.iloc[column]
            axis = figure.add_subplot(grid[row, column])
            map_axes.append(axis)
            scatter = axis.scatter(
                record["xy"][:, 0], record["xy"][:, 1], c=record["expression"],
                cmap="magma", vmin=color_min, vmax=color_max, marker="s", s=8,
                linewidths=0, rasterized=True,
            )
            axis.invert_yaxis()
            axis.set_aspect("equal")
            axis.set_xticks([])
            axis.set_yticks([])
            axis.set_title(f"P90$-$P50 = {record['gap']:.2f}", fontsize=9)
            if column == 0:
                axis.set_ylabel(label, fontsize=11)

    box_axis = figure.add_subplot(grid[:, 5])
    non_gap = frame.loc[frame["response"] == 0, "gap"].to_numpy()
    resp_gap = frame.loc[frame["response"] == 1, "gap"].to_numpy()
    groups = [non_gap, resp_gap]
    colors = ["#3b6ea5", "#d1495b"]
    boxes = box_axis.boxplot(groups, positions=[0, 1], widths=0.5, patch_artist=True, showfliers=False)
    for box, color in zip(boxes["boxes"], colors):
        box.set_facecolor(color)
        box.set_alpha(0.35)
        box.set_edgecolor(color)
    for median in boxes["medians"]:
        median.set_color("#222")
    rng = np.random.default_rng(0)
    for position, values, color in zip((0, 1), groups, colors):
        box_axis.scatter(position + rng.normal(0, 0.06, len(values)), values,
                         s=16, color=color, alpha=0.65, edgecolor="none")
    p_value = mannwhitneyu(non_gap, resp_gap, alternative="two-sided").pvalue
    box_axis.set_xticks([0, 1])
    box_axis.set_xticklabels(["Non-responder", "Responder"])
    box_axis.set_ylabel("SOD2 hotspot gap (P90$-$P50)")
    box_axis.set_title(f"All patients (n=85)\nMann–Whitney p = {p_value:.1e}", fontsize=9.5)

    colorbar_axis = figure.add_subplot(grid[:, 3])
    colorbar = figure.colorbar(scatter, cax=colorbar_axis)
    colorbar.set_label("Predicted SOD2 (log1p)", fontsize=9)
    figure.suptitle("SOD2 intratumoral dispersion is higher in non-responders", fontsize=12.5)
    figure.savefig(FIG_DIR / "her2_sod2.pdf", bbox_inches="tight")
    figure.savefig(FIG_DIR / "her2_sod2.png", bbox_inches="tight", dpi=150)
    plt.close(figure)
    print("wrote", FIG_DIR / "her2_sod2.pdf")


if __name__ == "__main__":
    main()
