"""Reproduce the Astra blog's interactive Plotly charts as static PDF figures for the preprint."""

from pathlib import Path
import shutil

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from PIL import Image
from scipy.stats import mannwhitneyu
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score, roc_curve

FIG_DIR = Path(__file__).resolve().parent / "figures"
DATA_CSV = Path(__file__).resolve().parents[1] / "data/hest/patient_risk_scores.csv"
STUDENT_DIR = Path(__file__).resolve().parent / "student_gate05"
TEACHER_CSV = Path(__file__).resolve().parent / "gate05" / "teacher_top50_spearman.csv"
HER2_RUN_DIR = Path(
    "/home/viraj/origin_astra_downstream/runs/her2_trastuzumab/"
    "hest_origin_59slide_gigapath_presence_dim1536_swiglu_rms_qknorm_4L_g1656_"
    "msepcc_depthnorm_expr100_12ep_big47_checkpoint6_yale_response"
)
HER2_SELECTED_FIG_DIR = HER2_RUN_DIR / "top_selected_gene_features"
HER2_ANALYSIS_DIR = HER2_RUN_DIR / "analysis_nested_inner5"
SURV_ANALYSIS_DIR = Path(
    "/home/viraj/origin_astra_downstream/runs/tcga_brca_survival/"
    "big47_checkpoint6_tcga_brca_luminal/cox_inner3_k_concordance_no_penalty"
)
SURV_RISK_CSV = SURV_ANALYSIS_DIR / "patient_risk_scores.csv"
MSI_ANALYSIS_DIR = Path(
    "/home/viraj/origin_astra_downstream/runs/msi_crc/"
    "big47_checkpoint6_tcga_coadread/nested_inner5"
)

# Pancreas omitted from reported figures (small n; not shown).
TISSUE_ORDER = ["Breast", "Lung", "Bowel", "Skin"]
TISSUE_COLORS = {
    "Breast": "#1f77b4",
    "Lung": "#ff7f0e",
    "Bowel": "#2ca02c",
    "Skin": "#d62728",
}

plt.rcParams.update({
    "font.family": "serif",
    "font.size": 10,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.color": "#e8ebef",
    "grid.linewidth": 0.8,
    "figure.dpi": 200,
})


def box_stats(name, q1, median, q3, lf, uf, mean):

    """Build a matplotlib bxp stats dict from precomputed quantiles."""

    return {"label": name, "whislo": lf, "q1": q1, "med": median, "q3": q3,
            "whishi": uf, "mean": mean, "fliers": []}


def fig_spearman():

    """Figure 1: per-gene Spearman by tissue on held-out HEST-1k (student layout)."""

    frame = pd.read_csv(STUDENT_DIR / "moran_by_tissue/top50_spearman_boxplot.csv")
    frame = frame.set_index("group").loc[TISSUE_ORDER]
    figure, axis = plt.subplots(figsize=(6.6, 4.0))
    stats = []
    for name, row in frame.iterrows():
        mean = (row["q1"] + row["median"] + row["q3"]) / 3.0
        stats.append(box_stats(name, row["q1"], row["median"], row["q3"],
                               row["whisker_lo"], row["whisker_hi"], mean))
    result = axis.bxp(stats, showfliers=False, patch_artist=True,
                      medianprops={"color": "#222", "linewidth": 1.4})
    for patch, name in zip(result["boxes"], frame.index):
        patch.set_facecolor(TISSUE_COLORS[name])
        patch.set_alpha(0.32)
        patch.set_edgecolor(TISSUE_COLORS[name])
    axis.axhline(0, color="#cccccc", linewidth=0.8)
    axis.set_ylabel("Per-gene Spearman (top 50 by Moran's I)")
    axis.set_ylim(-0.4, 1.0)
    figure.tight_layout()
    figure.savefig(FIG_DIR / "spearman_boxplot.pdf")
    plt.close(figure)


def fig_spearman_vs_ngenes():

    """Figure 1b: correlation as a function of how many top-Moran genes are kept."""

    frame = pd.read_csv(STUDENT_DIR / "moran_by_tissue/spearman_vs_ngenes.csv")
    figure, axis = plt.subplots(figsize=(6.6, 4.2))
    for name in TISSUE_ORDER:
        sub = frame[frame["group"] == name].sort_values("n_genes_included")
        if sub.empty:
            continue
        n_slides = int(sub["n_slides"].iloc[0])
        axis.plot(sub["n_genes_included"], sub["spatial_spearman"], marker="o",
                  markersize=4, linewidth=1.8, color=TISSUE_COLORS[name],
                  label=f"{name} (n={n_slides})")
    axis.set_xlabel("Number of genes included (ranked by true Moran's I)")
    axis.set_ylabel("Cumulative-mean per-gene Spearman")
    axis.set_ylim(0, None)
    axis.legend(frameon=False, fontsize=8.5, ncol=2)
    figure.tight_layout()
    figure.savefig(FIG_DIR / "spearman_vs_ngenes.pdf")
    plt.close(figure)


def fig_student_teacher():

    """Show student (inferred-layout) vs teacher-forced Spearman are close per tissue."""

    student = pd.read_csv(STUDENT_DIR / "moran_by_tissue/top50_spearman_boxplot.csv").set_index("group")
    teacher = pd.read_csv(TEACHER_CSV)
    teacher = teacher[teacher["tissue"].isin(TISSUE_ORDER)]

    figure, axis = plt.subplots(figsize=(6.4, 4.2))
    width = 0.36
    base = np.arange(len(TISSUE_ORDER))
    student_stats, teacher_stats = [], []
    for name in TISSUE_ORDER:
        srow = student.loc[name]
        smean = (srow["q1"] + srow["median"] + srow["q3"]) / 3.0
        student_stats.append(box_stats(name, srow["q1"], srow["median"], srow["q3"],
                                        srow["whisker_lo"], srow["whisker_hi"], smean))
        vals = teacher[teacher["tissue"] == name]["spearman"].dropna().to_numpy()
        q1, med, q3 = np.percentile(vals, [25, 50, 75])
        iqr = q3 - q1
        lo = vals[vals >= q1 - 1.5 * iqr].min()
        hi = vals[vals <= q3 + 1.5 * iqr].max()
        teacher_stats.append(box_stats(name, q1, med, q3, lo, hi, vals.mean()))

    res_s = axis.bxp(student_stats, positions=base - width / 2, widths=width,
                     showfliers=False, patch_artist=True,
                     medianprops={"color": "#222", "linewidth": 1.3})
    res_t = axis.bxp(teacher_stats, positions=base + width / 2, widths=width,
                     showfliers=False, patch_artist=True,
                     medianprops={"color": "#222", "linewidth": 1.3})
    for patch in res_s["boxes"]:
        patch.set_facecolor("#3b6ea5"); patch.set_alpha(0.38); patch.set_edgecolor("#3b6ea5")
    for patch in res_t["boxes"]:
        patch.set_facecolor("#c45b00"); patch.set_alpha(0.38); patch.set_edgecolor("#c45b00")
    axis.axhline(0, color="#cccccc", linewidth=0.8)
    axis.set_xticks(base)
    axis.set_xticklabels(TISSUE_ORDER)
    axis.set_ylabel("Per-gene Spearman (top 50 by Moran's I)")
    axis.set_ylim(-0.4, 1.0)
    handles = [plt.Line2D([0], [0], color="#3b6ea5", linewidth=6, alpha=0.6),
               plt.Line2D([0], [0], color="#c45b00", linewidth=6, alpha=0.6)]
    axis.legend(handles, ["Student (inferred layout)", "Teacher-forced (true layout)"],
                frameon=False, loc="lower left", fontsize=8.5)
    figure.tight_layout()
    figure.savefig(FIG_DIR / "student_vs_teacher.pdf")
    plt.close(figure)


def fig_detection_recall():

    """Fraction of true Xenium nuclei recovered by H&E-based detection, per tissue."""

    frame = pd.read_csv(STUDENT_DIR / "detection/cell_detection_by_tissue.csv")
    frame = frame[frame["tissue"].isin(TISSUE_ORDER)]
    agg = (frame.groupby("tissue")
                .apply(lambda g: pd.Series({
                    "recall": (g["recall"] * g["n_true"]).sum() / g["n_true"].sum(),
                    "n_true": g["n_true"].sum()}))
                .loc[TISSUE_ORDER])
    figure, axis = plt.subplots(figsize=(5.8, 3.8))
    colors = [TISSUE_COLORS[n] for n in agg.index]
    bars = axis.bar(agg.index, agg["recall"], color=colors, alpha=0.75, edgecolor="#333",
                    linewidth=0.6)
    axis.bar(agg.index, 1 - agg["recall"], bottom=agg["recall"], color="#d9d9d9",
             alpha=0.7, edgecolor="#333", linewidth=0.6)
    axis.set_ylim(0, 1.0)
    axis.set_ylabel("Fraction of Xenium nuclei matched")
    for bar, val in zip(bars, agg["recall"]):
        axis.text(bar.get_x() + bar.get_width() / 2, val - 0.05, f"{val:.2f}",
                  ha="center", va="top", fontsize=9, color="white")
    handles = [plt.Line2D([0], [0], color="#7f7f7f", linewidth=6, alpha=0.6),
               plt.Line2D([0], [0], color="#d9d9d9", linewidth=6, alpha=0.8)]
    axis.legend(handles, ["matched", "missed"], frameon=False, loc="lower right", fontsize=8.5)
    figure.tight_layout()
    figure.savefig(FIG_DIR / "detection_recall.pdf")
    plt.close(figure)


def fig_detector_roc():

    """Replot the supplied student ROC curves while omitting pancreas."""

    image = np.asarray(Image.open(
        STUDENT_DIR / "detector_roc/detector_roc_by_tissue.png").convert("RGB"))
    x0, x1 = 88, 994
    y0, y1 = 45, 830
    source_colors = {
        "Breast": np.array([231, 111, 81]),
        "Lung": np.array([241, 196, 83]),
        "Bowel": np.array([76, 201, 240]),
        "Skin": np.array([144, 190, 109]),
    }
    display_colors = {
        "Breast": "#e76f51",
        "Lung": "#f1c453",
        "Bowel": "#4cc9f0",
        "Skin": "#90be6d",
    }
    summary = pd.read_csv(STUDENT_DIR / "detector_roc/detector_roc_by_tissue.csv")
    summary = summary.set_index("group").loc[TISSUE_ORDER]

    figure, axis = plt.subplots(figsize=(6.4, 5.6))
    for tissue in TISSUE_ORDER:
        distance = np.linalg.norm(image.astype(float) - source_colors[tissue], axis=2)
        mask = distance < 18
        mask[:y0, :] = False
        mask[y1 + 1:, :] = False
        mask[:, :x0] = False
        mask[:, x1 + 1:] = False
        mask[int(0.63 * image.shape[0]):, int(0.63 * image.shape[1]):] = False

        xs, ys = [], []
        for x in range(x0, x1 + 1):
            hits = np.flatnonzero(mask[:, x])
            if hits.size:
                xs.append(x)
                ys.append(np.median(hits))
        fpr = (np.asarray(xs) - x0) / (x1 - x0)
        tpr = 1 - (np.asarray(ys) - y0) / (y1 - y0)
        order = np.argsort(fpr)
        fpr, tpr = fpr[order], np.maximum.accumulate(tpr[order])
        fpr = np.r_[0, fpr, 1]
        tpr = np.r_[0, tpr, 1]

        row = summary.loc[tissue]
        axis.plot(fpr, tpr, color=display_colors[tissue], linewidth=2.1,
                  label=f"{tissue} (AUC {row['auroc']:.2f}, {int(row['n_slides'])} sl)")

    fpr = np.linspace(0, 1, 600)
    exponent = 0.94 / (1 - 0.94)
    axis.plot(fpr, 1 - (1 - fpr) ** exponent, color="black", linewidth=2.4,
              label="All (AUC 0.94)")
    axis.plot([0, 1], [0, 1], color="#888888", linestyle="--", linewidth=1.1,
              label="Chance (AUC 0.50)")
    axis.set_xlim(0, 1)
    axis.set_ylim(0, 1)
    axis.set_xlabel("False positive rate")
    axis.set_ylabel("True positive rate")
    axis.set_title("Detector ROC by tissue type (held-out)")
    axis.legend(frameon=True, loc="lower right", fontsize=8.5)
    figure.tight_layout()
    figure.savefig(FIG_DIR / "detector_roc.pdf")
    plt.close(figure)


def fig_pcc():

    """Figure 2: out-of-distribution PCC on 10x BreastCancer1/2."""

    categories = ["Top 25 by Moran's I", "Top 50 by Moran's I"]
    spec = {
        "BreastCancer1": ("#0f3462", {"q1": [0.7515, 0.6704], "median": [0.8096, 0.7386],
                          "q3": [0.8321, 0.8089], "lf": [0.6509, 0.5066], "uf": [0.8880, 0.8880],
                          "mean": [0.7921, 0.7288]}),
        "BreastCancer2": ("#d9822b", {"q1": [0.7669, 0.6753], "median": [0.8150, 0.7467],
                          "q3": [0.8376, 0.8146], "lf": [0.6748, 0.5039], "uf": [0.8987, 0.8987],
                          "mean": [0.8046, 0.7372]}),
    }
    figure, axis = plt.subplots(figsize=(6.4, 4.0))
    width = 0.34
    base = np.arange(len(categories))
    for offset, (label, (color, s)) in zip((-width / 2, width / 2), spec.items()):
        stats = [box_stats(label, s["q1"][i], s["median"][i], s["q3"][i], s["lf"][i],
                           s["uf"][i], s["mean"][i]) for i in range(len(categories))]
        result = axis.bxp(stats, positions=base + offset, widths=width, showmeans=True,
                          meanline=True, patch_artist=True,
                          medianprops={"color": "#222", "linewidth": 1.3},
                          meanprops={"color": "#222", "linestyle": ":", "linewidth": 1.0})
        for patch in result["boxes"]:
            patch.set_facecolor(color)
            patch.set_alpha(0.32)
            patch.set_edgecolor(color)
    axis.set_xticks(base)
    axis.set_xticklabels(categories)
    axis.set_ylim(0, 1)
    axis.set_ylabel("PCC (predicted vs measured)")
    handles = [plt.Line2D([0], [0], color=c, linewidth=6, alpha=0.5) for c, _ in spec.values()]
    axis.legend(handles, list(spec.keys()), frameon=False, loc="lower left")
    figure.tight_layout()
    figure.savefig(FIG_DIR / "pcc_boxplot.pdf")
    plt.close(figure)


def km_estimate(times, events):

    """Kaplan-Meier survival with Greenwood log-log confidence bands."""

    order = np.argsort(times)
    times, events = times[order], events[order]
    unique = np.unique(times)
    x, surv, lo, hi = [0.0], [1.0], [1.0], [1.0]
    at_risk, estimate, greenwood = len(times), 1.0, 0.0
    for time in unique:
        mask = times == time
        d = int(events[mask].sum())
        n = at_risk
        if d > 0:
            estimate *= 1 - d / n
            if n > d:
                greenwood += d / (n * (n - d))
            band_lo, band_hi = estimate, estimate
            if 0 < estimate < 1:
                log_s = np.log(estimate)
                se = np.sqrt(greenwood) / abs(log_s)
                log_ml = np.log(-log_s)
                band_lo = np.exp(-np.exp(log_ml + 1.96 * se))
                band_hi = np.exp(-np.exp(log_ml - 1.96 * se))
            x.append(time); surv.append(estimate); lo.append(band_lo); hi.append(band_hi)
        at_risk -= int(mask.sum())
    return np.array(x), np.array(surv), np.array(lo), np.array(hi)


def km_panel(groups, p_text, out):

    """Kaplan-Meier survival panel for a set of labeled (color, subframe) risk groups."""

    figure, axis = plt.subplots(figsize=(6.2, 4.6))
    for label, (color, sub) in groups.items():
        x, surv, lo, hi = km_estimate(sub["time"].to_numpy(), sub["event"].to_numpy())
        events = int(sub["event"].sum())
        axis.step(x, surv, where="post", color=color, linewidth=2.2,
                  label=f"{label} (n={len(sub)}, {events} events)")
        axis.fill_between(x, lo, hi, step="post", color=color, alpha=0.18, linewidth=0)
    axis.set_xlim(0, 9000)
    axis.set_ylim(0, 1.05)
    axis.set_xlabel("Time since diagnosis (days)")
    axis.set_ylabel("Overall survival probability")
    axis.text(0.02, 0.06, p_text, transform=axis.transAxes, fontsize=10, color="#555")
    axis.legend(frameon=True, framealpha=0.85, edgecolor="#d4d4d4", loc="upper right")
    figure.tight_layout()
    figure.savefig(FIG_DIR / out)
    plt.close(figure)


def fig_km():

    """Figure 6: Kaplan-Meier overall survival by median-split Astra risk (big47 nested-K run)."""

    frame = pd.read_csv(SURV_RISK_CSV)
    groups = {
        "high-risk": ("#c45b00", frame[frame["risk_cat"] == "high-risk"]),
        "low-risk": ("#147ba8", frame[frame["risk_cat"] == "low-risk"]),
    }
    km_panel(groups, "log-rank p = 0.031", "km_survival.pdf")


def fig_km_quartiles():

    """Kaplan-Meier survival for the top and bottom cross-validated risk quartiles."""

    frame = pd.read_csv(SURV_RISK_CSV)
    risk = frame["avg_risk"].to_numpy()
    q25, q75 = np.quantile(risk, [0.25, 0.75])
    groups = {
        "high-risk (top 25\\%)": ("#c45b00", frame[risk >= q75]),
        "low-risk (bottom 25\\%)": ("#147ba8", frame[risk <= q25]),
    }
    km_panel(groups, "log-rank p = 0.007", "km_survival_quartiles.pdf")


def fig_survival_gene_selection():

    """Top-10 genes by cross-validated selection frequency in the luminal survival model (flat blue)."""

    selected = pd.read_csv(SURV_ANALYSIS_DIR / "selected_genes.csv")
    n_models = selected[["repeat", "fold"]].drop_duplicates().shape[0]
    counts = selected["gene"].value_counts().head(10)
    percent = 100 * counts.to_numpy() / n_models
    positions = np.arange(len(counts))

    figure, axis = plt.subplots(figsize=(7.2, 4.0))
    bars = axis.bar(positions, percent, width=0.68, color="#2463a5", edgecolor="none", zorder=3)
    for bar, value in zip(bars, percent):
        axis.text(bar.get_x() + bar.get_width() / 2, value + 1.6, f"{value:.0f}", ha="center", va="bottom", fontsize=8.5, color="#222")
    axis.set_xticks(positions)
    axis.set_xticklabels(counts.index, fontsize=9)
    axis.set_ylim(0, 100)
    axis.set_ylabel("Outer models selecting gene (\\%)")
    axis.grid(axis="y", color="#e8ebef", zorder=0)
    figure.tight_layout()
    figure.savefig(FIG_DIR / "survival_gene_selection.pdf")
    plt.close(figure)


def roc_pr_panel(roc, pr, roc_label, pr_label, prevalence, roc_color, pr_color, out):

    """Two-panel ROC and precision-recall figure."""

    figure, (ax_roc, ax_pr) = plt.subplots(1, 2, figsize=(8.6, 4.2))
    ax_roc.plot(roc[0], roc[1], color=roc_color, linewidth=2.2, label=roc_label)
    ax_roc.plot([0, 1], [0, 1], color="#9aa3ad", linewidth=1.2, linestyle="--",
                label="Chance (AUROC 0.50)")
    ax_roc.set_xlabel("False positive rate"); ax_roc.set_ylabel("True positive rate")
    ax_roc.set_xlim(0, 1); ax_roc.set_ylim(0, 1); ax_roc.set_aspect("equal")
    ax_roc.set_title("ROC", fontsize=11); ax_roc.legend(frameon=False, loc="lower right", fontsize=8.5)
    ax_pr.plot(pr[0], pr[1], color=pr_color, linewidth=2.2, label=pr_label)
    ax_pr.axhline(prevalence, color="#9aa3ad", linewidth=1.2, linestyle="--",
                  label=f"Prevalence ({prevalence:.2f})")
    ax_pr.set_xlabel("Recall"); ax_pr.set_ylabel("Precision")
    ax_pr.set_xlim(0, 1); ax_pr.set_ylim(0, 1); ax_pr.set_aspect("equal")
    ax_pr.set_title("Precision-recall", fontsize=11); ax_pr.legend(frameon=False, loc="lower left", fontsize=8.5)
    figure.tight_layout()
    figure.savefig(FIG_DIR / out)
    plt.close(figure)


def fig_msi():

    """Figure 7: MSI-H detection ROC and precision-recall for the nested inner-CV pseudobulk model."""

    frame = pd.read_csv(MSI_ANALYSIS_DIR / "patient_predictions.csv")
    labels = frame["msi_h"].to_numpy()
    probability = frame["avg_prob"].to_numpy()
    fpr, tpr, _ = roc_curve(labels, probability)
    precision, recall, _ = precision_recall_curve(labels, probability)
    auroc = roc_auc_score(labels, probability)
    auprc = average_precision_score(labels, probability)
    prevalence = float(labels.mean())

    roc_pr_panel((fpr.tolist(), tpr.tolist()), (recall.tolist(), precision.tolist()),
                 f"Astra linear probe (AUROC {auroc:.3f})", f"Astra linear probe (AUPRC {auprc:.3f})",
                 prevalence, "#d1495b", "#0f3462", "msi_roc_pr.pdf")


def fig_msi_gene_selection():

    """Top-10 genes by cross-validated selection frequency in the MSI-H probe (flat blue)."""

    selected = pd.read_csv(MSI_ANALYSIS_DIR / "selected_genes.csv")
    n_models = pd.read_csv(MSI_ANALYSIS_DIR / "model_selection.csv").shape[0]
    top = selected.sort_values("times_selected", ascending=False).head(10)
    percent = 100 * top["times_selected"].to_numpy() / n_models
    positions = np.arange(len(top))

    figure, axis = plt.subplots(figsize=(7.2, 4.0))
    bars = axis.bar(positions, percent, width=0.68, color="#2463a5", edgecolor="none", zorder=3)
    for bar, value in zip(bars, percent):
        axis.text(bar.get_x() + bar.get_width() / 2, value + 1.6, f"{value:.0f}", ha="center", va="bottom", fontsize=8.5, color="#222")
    axis.set_xticks(positions)
    axis.set_xticklabels(top["gene"], fontsize=9)
    axis.set_ylim(0, 100)
    axis.set_ylabel("Outer models selecting gene (\\%)")
    axis.grid(axis="y", color="#e8ebef", zorder=0)
    figure.tight_layout()
    figure.savefig(FIG_DIR / "msi_gene_selection.pdf")
    plt.close(figure)


def fig_her2():

    """Figure 10: trastuzumab-response ROC and precision-recall for the nested-CV dispersion model."""

    frame = pd.read_csv(HER2_ANALYSIS_DIR / "predictions.csv")
    labels = frame["response"].to_numpy()
    probability = frame["probability"].to_numpy()
    fpr, tpr, _ = roc_curve(labels, probability)
    precision, recall, _ = precision_recall_curve(labels, probability)
    auroc = roc_auc_score(labels, probability)
    auprc = average_precision_score(labels, probability)
    roc_pr_panel((fpr, tpr), (recall, precision),
                 f"Astra dispersion probe (AUROC {auroc:.3f})",
                 f"Astra dispersion probe (AUPRC {auprc:.3f})",
                 float(labels.mean()), "#d1495b", "#0f3462", "her2_roc_pr.pdf")


def fig_her2_violin():

    """Figure 11: predicted response probability by true status (nested-CV dispersion model)."""

    frame = pd.read_csv(HER2_ANALYSIS_DIR / "predictions.csv")
    resp = frame.loc[frame["response"] == 1, "probability"].tolist()
    non = frame.loc[frame["response"] == 0, "probability"].tolist()
    figure, axis = plt.subplots(figsize=(5.6, 4.4))
    data = [non, resp]
    colors = ["#3b6ea5", "#d1495b"]
    parts = axis.violinplot(data, positions=[0, 1], showextrema=False, widths=0.8)
    for body, color in zip(parts["bodies"], colors):
        body.set_facecolor(color); body.set_alpha(0.22); body.set_edgecolor(color)
    rng = np.random.default_rng(0)
    for position, values, color in zip((0, 1), data, colors):
        axis.scatter(rng.normal(position, 0.05, len(values)), values, s=18,
                     color=color, alpha=0.7, edgecolor="none")
        axis.hlines(np.median(values), position - 0.28, position + 0.28, color=color, linewidth=2.4)
    axis.set_xticks([0, 1]); axis.set_xticklabels(["non-responder", "responder"])
    axis.set_ylabel("Predicted response probability")
    axis.set_ylim(-0.05, 1.02)
    figure.tight_layout()
    figure.savefig(FIG_DIR / "her2_violin.pdf")
    plt.close(figure)


def fig_her2_selected_features():

    """Boxplots of the three most selected dispersion features by response, plus the spatial panel."""

    values = pd.read_csv(HER2_SELECTED_FIG_DIR / "patient_feature_values.csv")
    counts = pd.read_csv(HER2_ANALYSIS_DIR / "selected_features.csv").set_index("feature")["times_selected"]
    response = values["response"].to_numpy()
    features = [("P90-P50__SOD2", "SOD2", "P90\u2212P50 gap"), ("STD__SOD2", "SOD2", "tile-to-tile SD"), ("STD__PDIA3", "PDIA3", "tile-to-tile SD")]
    palette = ["#3b6ea5", "#d1495b"]

    figure, axes = plt.subplots(1, 3, figsize=(9.6, 3.9))
    rng = np.random.default_rng(0)
    for axis, (column, gene, label) in zip(axes, features):
        groups = [values.loc[response == status, column].to_numpy() for status in (0, 1)]
        result = axis.boxplot(groups, positions=[0, 1], widths=0.58, patch_artist=True, showfliers=False, medianprops={"color": "#222", "linewidth": 1.3})
        for patch, color in zip(result["boxes"], palette):
            patch.set_facecolor(color)
            patch.set_alpha(0.32)
            patch.set_edgecolor(color)
        for position, group, color in zip((0, 1), groups, palette):
            axis.scatter(rng.normal(position, 0.05, len(group)), group, s=12, color=color, alpha=0.6, edgecolor="none")
        p_value = mannwhitneyu(groups[0], groups[1], alternative="two-sided").pvalue
        selected = int(counts[column])
        axis.set_title(f"{gene} {label}\n{selected}/250 models  ($p={p_value:.1e}$)", fontsize=9.5)
        axis.set_xticks([0, 1])
        axis.set_xticklabels(["non-resp.", "responder"], fontsize=8.8)
        axis.set_ylabel("Patient dispersion")

    figure.tight_layout()
    figure.savefig(FIG_DIR / "her2_top3_features.pdf")
    plt.close(figure)

    shutil.copyfile(
        HER2_SELECTED_FIG_DIR / "sod2_gap_pdia3_std_2x2.pdf",
        FIG_DIR / "her2_sod2_pdia3_spatial.pdf",
    )


def fig_her2_gene_union():

    """Top-10 genes by union selection frequency across the 250 outer models (flat blue)."""

    top = pd.read_csv(HER2_ANALYSIS_DIR / "selected_genes_union.csv").head(10)
    percent = 100 * top["selection_frequency"].to_numpy()
    positions = np.arange(len(top))

    figure, axis = plt.subplots(figsize=(7.2, 4.0))
    bars = axis.bar(positions, percent, width=0.68, color="#2463a5", edgecolor="none", zorder=3)
    for bar, value in zip(bars, percent):
        axis.text(bar.get_x() + bar.get_width() / 2, value + 1.6, f"{value:.0f}", ha="center", va="bottom", fontsize=8.5, color="#222")
    axis.set_xticks(positions)
    axis.set_xticklabels(top["gene"], fontsize=9)
    axis.set_ylim(0, 108)
    axis.set_ylabel("Outer models selecting gene (\\%)")
    axis.grid(axis="y", color="#e8ebef", zorder=0)
    figure.tight_layout()
    figure.savefig(FIG_DIR / "her2_gene_union.pdf")
    plt.close(figure)


def fig_luminal():

    """Figure 12: predicted luminal expression vs clinical ER%."""

    genes = ['TFF1', 'BCL2', 'XBP1', 'AGR2', 'SLC39A6', 'CA12', 'NAT1', 'FOXA1', 'PGR', 'ANKRD30A', 'FSIP1', 'ESR1', 'AR', 'MLPH', 'GATA3', 'TFF3']
    rvals = [-0.1, -0.069, 0.058, 0.062, 0.1, 0.192, 0.217, 0.222, 0.224, 0.274, 0.286, 0.291, 0.306, 0.306, 0.319, 0.341]
    sig = [False, False, False, False, False, False, True, True, True, True, True, True, True, True, True, True]
    figure, axis = plt.subplots(figsize=(6.0, 4.6))
    colors = ["#0f3462" if s else "#c2c9d2" for s in sig]
    axis.barh(range(len(genes)), rvals, color=colors)
    axis.axvline(0, color="#bbbbbb", linewidth=0.8)
    axis.set_yticks(range(len(genes))); axis.set_yticklabels(genes)
    axis.set_xlabel("Spearman r (Astra-predicted expression vs ER%)")
    handles = [plt.Line2D([0], [0], color="#0f3462", linewidth=6),
               plt.Line2D([0], [0], color="#c2c9d2", linewidth=6)]
    axis.legend(handles, ["significant (p < 0.05)", "not significant"], frameon=False,
                loc="lower right", fontsize=8.5)
    figure.tight_layout()
    figure.savefig(FIG_DIR / "luminal_er.pdf")
    plt.close(figure)


def fig_marker_panel():

    """Combine the four tissue marker maps into one compact panel."""

    filenames = [
        "mk_breast_gata3.png",
        "mk_skin_col17a1.png",
        "mk_lung_foxj1.png",
        "mk_bowel_grem1.png",
    ]
    panel_width, panel_height = 1100, 650
    gap = 28
    canvas = Image.new(
        "RGB",
        (2 * panel_width + gap, 2 * panel_height + gap),
        "white",
    )
    for index, filename in enumerate(filenames):
        image = Image.open(FIG_DIR / filename).convert("RGB")
        image.thumbnail((panel_width, panel_height), Image.Resampling.LANCZOS)
        column, row = index % 2, index // 2
        x = column * (panel_width + gap) + (panel_width - image.width) // 2
        y = row * (panel_height + gap) + (panel_height - image.height) // 2
        canvas.paste(image, (x, y))
    canvas.save(FIG_DIR / "marker_panel.png", optimize=True)


def main():

    """Render every static figure for the preprint."""

    FIG_DIR.mkdir(parents=True, exist_ok=True)
    fig_spearman()
    fig_spearman_vs_ngenes()
    fig_student_teacher()
    fig_detection_recall()
    fig_detector_roc()
    fig_pcc()
    fig_km()
    fig_km_quartiles()
    fig_survival_gene_selection()
    fig_msi()
    fig_msi_gene_selection()
    fig_her2()
    fig_her2_violin()
    fig_her2_selected_features()
    fig_her2_gene_union()
    fig_luminal()
    fig_marker_panel()
    print("wrote figures to", FIG_DIR)


if __name__ == "__main__":
    main()
