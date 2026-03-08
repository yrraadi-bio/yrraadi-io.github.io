"""Prepare JSON data files for the training-data blog's interactive Plotly visualisations.

Reads source CSVs, subsamples/transforms, and writes compact JSON files that
are loaded by <script> tags in the blog HTML.

Usage:
    cd /home/username/yrraadi-io.github.io/blogs/training-data
    python3 prepare_data.py
"""

import json
import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import linkage, leaves_list
from scipy.spatial.distance import squareform

# ── Paths ─────────────────────────────────────────────────────────────────────

DATA_ROOT = "/home/username/projects"
OUT_DIR = "."  # writes into the same directory as this script

UMAP_CSV = f"{DATA_ROOT}/brain_snatac/data/singlecell/subsample_with_umap.csv"
JSD_CSV = f"{DATA_ROOT}/brain_snatac/results/diversity/cell_type_jsd_matrix.csv"
JACCARD_CSV = f"{DATA_ROOT}/brain_snatac/results/diversity/ccre_coordinate_overlap_jaccard.csv"
GINI_CSV = f"{DATA_ROOT}/brain_snatac/results/diversity/motif_specificity_scores.csv"
PERM_CSV = f"{DATA_ROOT}/ccre_pca/results/quantitative_pca/brain_analysis/significance/permutation_variance.csv"
CONC_CSV = f"{DATA_ROOT}/brain_snatac/results/diversity/bulk_vs_sc_tf_comparison.csv"

# ── Lineage definitions (mirrors blog_figures.py) ────────────────────────────

LINEAGE_MAP = {
    'Astrocyte':           ['ASCNT_1','ASCNT_2','ASCNT_3','ASCT_1','ASCT_2','ASCT_3'],
    'Oligodendrocyte':     ['OGC_1','OGC_2','OGC_3','OPC','COP'],
    'Microglia':           ['MGC_1','MGC_2'],
    'Exc (IT L2/3)':       ['ITL23_1','ITL23_2','ITL23_3','ITL23_4','ITL23_5','ITL23_6'],
    'Exc (IT L4)':         ['ITL4_1','ITL4_2'],
    'Exc (IT L5)':         ['ITL5_1','ITL5_2','ITL5_3','ITL5_4'],
    'Exc (IT L6)':         ['ITL6_1_1','ITL6_1_2','ITL6_2_1','ITL6_2_2'],
    'Exc (IT V1C)':        ['ITV1C_1','ITV1C_2','ITV1C_3'],
    'Exc (IT L4/5)':       ['ITL45_1','ITL45_2'],
    'Exc (IT L3/4)':       ['ITL34'],
    'Exc (other)':         ['ET','CT_1','CT_2','L6B_1','L6B_2','NP_1','NP_2','NP_3','ERC_1','ERC_2'],
    'MSN':                 ['MSN_1','MSN_2','MSN_3','D12NAC','D1CaB','D1Pu','D2CaB','D2Pu'],
    'Inh (PVALB)':         ['PVALB_1','PVALB_2','PVALB_3','PVALB_4','PV_ChCs'],
    'Inh (SST)':           ['SST_1','SST_2','SST_3','SST_4','SST_5','SST_CHODL'],
    'Inh (VIP)':           ['VIP_1','VIP_2','VIP_3','VIP_4','VIP_5','VIP_6','VIP_7'],
    'Inh (SNCG)':          ['SNCG_1','SNCG_2','SNCG_3','SNCG_4','SNCG_5'],
    'Inh (LAMP5)':         ['LAMP5_1'],
    'Other neuron':        ['FOXP2_1','FOXP2_2','FOXP2_3','FOXP2_4','PIR','SUB','TP'],
    'Other / rare':        ['ACBGM','AMY','BFEXA','BNGA','CBGRC','CHO','CNMIX',
                            'CNGA_1','CNGA_2','EC','ICGA_1','ICGA_2','MDGA',
                            'PKJ_1','PKJ_2','SEPGA','SIGA','SMC','THMGA_1','THMGA_2'],
}

LINEAGE_PALETTE = {
    'Astrocyte':       '#7B3294',
    'Oligodendrocyte': '#1B7837',
    'Microglia':       '#C51B7D',
    'Exc (IT L2/3)':   '#2166AC',
    'Exc (IT L4)':     '#4393C3',
    'Exc (IT L5)':     '#2166AC',
    'Exc (IT L6)':     '#4393C3',
    'Exc (IT V1C)':    '#2166AC',
    'Exc (IT L4/5)':   '#4393C3',
    'Exc (IT L3/4)':   '#2166AC',
    'Exc (other)':     '#67A9CF',
    'MSN':             '#E66101',
    'Inh (PVALB)':     '#D6604D',
    'Inh (SST)':       '#F4A582',
    'Inh (VIP)':       '#D6604D',
    'Inh (SNCG)':      '#F4A582',
    'Inh (LAMP5)':     '#D6604D',
    'Other neuron':    '#878787',
    'Other / rare':    '#B8B8B8',
}

# Broad lineage groupings for the UMAP (8 major types)
BROAD_LINEAGE = {
    'Astrocyte':       'Astrocyte',
    'Oligodendrocyte': 'Oligodendrocyte',
    'Microglia':       'Microglia',
    'Exc (IT L2/3)':   'Excitatory neuron',
    'Exc (IT L4)':     'Excitatory neuron',
    'Exc (IT L5)':     'Excitatory neuron',
    'Exc (IT L6)':     'Excitatory neuron',
    'Exc (IT V1C)':    'Excitatory neuron',
    'Exc (IT L4/5)':   'Excitatory neuron',
    'Exc (IT L3/4)':   'Excitatory neuron',
    'Exc (other)':     'Excitatory neuron',
    'MSN':             'MSN',
    'Inh (PVALB)':     'Inhibitory neuron',
    'Inh (SST)':       'Inhibitory neuron',
    'Inh (VIP)':       'Inhibitory neuron',
    'Inh (SNCG)':      'Inhibitory neuron',
    'Inh (LAMP5)':     'Inhibitory neuron',
    'Other neuron':    'Other neuron',
    'Other / rare':    'Other / rare',
}

BROAD_PALETTE = {
    'Excitatory neuron': '#2166AC',
    'Inhibitory neuron': '#D6604D',
    'MSN':               '#E66101',
    'Astrocyte':         '#7B3294',
    'Oligodendrocyte':   '#1B7837',
    'Microglia':         '#C51B7D',
    'Other neuron':      '#878787',
    'Other / rare':      '#B8B8B8',
}


def cell_to_lineage():
    m = {}
    for lin, cells in LINEAGE_MAP.items():
        for c in cells:
            m[c] = lin
    return m


def lineage_order(available):
    out = []
    for cells in LINEAGE_MAP.values():
        out.extend(c for c in cells if c in available)
    return out + [c for c in available if c not in out]


# ── 1. UMAP data ─────────────────────────────────────────────────────────────

def prepare_umap():
    print("Preparing UMAP data...")
    df = pd.read_csv(UMAP_CSV)

    # Build cluster→lineage mapping
    c2l = cell_to_lineage()
    # We need to map cluster IDs to cell types. The cluster column is numeric.
    # We'll create a mapping from the most common cell type label per cluster.
    # But the data only has cluster numbers, not cell type names directly.
    # Instead, assign broad lineage based on UMAP position clustering.
    # For now, use cluster as the categorical variable.

    # Subsample to ~30K cells, stratified by cluster
    n_target = 30000
    n_total = len(df)
    frac = n_target / n_total

    rng = np.random.RandomState(42)
    sub = df.groupby('cluster', group_keys=False).apply(
        lambda x: x.sample(frac=min(frac * 1.1, 1.0), random_state=rng)
    ).head(n_target)

    # Round coordinates for compactness
    result = {
        'umap1': [round(v, 3) for v in sub['UMAP1'].tolist()],
        'umap2': [round(v, 3) for v in sub['UMAP2'].tolist()],
        'cluster': sub['cluster'].tolist(),
        'region': sub['region'].tolist(),
        'donor': sub['donor'].tolist(),
    }

    with open(f"{OUT_DIR}/umap_data.json", 'w') as f:
        json.dump(result, f, separators=(',', ':'))
    print(f"  → umap_data.json ({len(sub):,} cells)")


# ── 2. JSD matrix ────────────────────────────────────────────────────────────

def prepare_jsd():
    print("Preparing JSD data...")
    df = pd.read_csv(JSD_CSV, index_col='cell_type')

    # Drop CBINH and LAMP5_LHX6 (as in blog_figures.py)
    drop = [c for c in ['CBINH', 'LAMP5_LHX6'] if c in df.index]
    df = df.drop(drop, axis=0).drop(drop, axis=1)

    # Order by lineage
    ordered = lineage_order(df.index.tolist())
    df = df.loc[ordered, ordered]

    # Hierarchical clustering for ordering
    vals = df.values.copy()
    np.fill_diagonal(vals, 0)
    condensed = squareform(vals, checks=False)
    Z = linkage(condensed, method='average')
    order = leaves_list(Z)
    labels = [df.index[i] for i in order]
    mat = df.loc[labels, labels].values.tolist()

    # Lineage annotations
    c2l = cell_to_lineage()
    lineages = [c2l.get(l, 'Other / rare') for l in labels]
    colors = [LINEAGE_PALETTE.get(lin, '#cccccc') for lin in lineages]

    result = {
        'labels': labels,
        'matrix': [[round(v, 5) for v in row] for row in mat],
        'lineages': lineages,
        'lineage_colors': colors,
    }

    with open(f"{OUT_DIR}/jsd_data.json", 'w') as f:
        json.dump(result, f, separators=(',', ':'))
    print(f"  → jsd_data.json ({len(labels)}×{len(labels)})")


# ── 3. Jaccard matrix ────────────────────────────────────────────────────────

def prepare_jaccard():
    print("Preparing Jaccard data...")
    df = pd.read_csv(JACCARD_CSV, index_col=0)

    # Drop CBINH and LAMP5_LHX6
    drop = [c for c in ['CBINH', 'LAMP5_LHX6'] if c in df.index]
    df = df.drop(drop, axis=0).drop(drop, axis=1)

    # Order by lineage
    ordered = lineage_order(df.index.tolist())
    df = df.loc[ordered, ordered]

    # Hierarchical clustering — Jaccard is similarity, convert to distance
    dist_vals = 1 - df.values.copy()
    np.fill_diagonal(dist_vals, 0)
    condensed = squareform(dist_vals, checks=False)
    Z = linkage(condensed, method='average')
    order = leaves_list(Z)
    labels = [df.index[i] for i in order]
    mat = df.loc[labels, labels].values.tolist()

    c2l = cell_to_lineage()
    lineages = [c2l.get(l, 'Other / rare') for l in labels]
    colors = [LINEAGE_PALETTE.get(lin, '#cccccc') for lin in lineages]

    result = {
        'labels': labels,
        'matrix': [[round(v, 5) for v in row] for row in mat],
        'lineages': lineages,
        'lineage_colors': colors,
    }

    with open(f"{OUT_DIR}/jaccard_data.json", 'w') as f:
        json.dump(result, f, separators=(',', ':'))
    print(f"  → jaccard_data.json ({len(labels)}×{len(labels)})")


# ── 4. Gini (motif specificity) ──────────────────────────────────────────────

def prepare_gini():
    print("Preparing Gini data...")
    df = pd.read_csv(GINI_CSV)
    df = df.sort_values('gini', ascending=False).reset_index(drop=True)

    result = {
        'motif': df['motif'].tolist(),
        'gini': [round(v, 4) for v in df['gini'].tolist()],
        'mean_hit_rate': [round(v, 6) for v in df['mean_hit_rate'].tolist()],
        'max_hit_rate': [round(v, 6) for v in df['max_hit_rate'].tolist()],
        'top_cell_type': df['top_cell_type'].tolist(),
    }

    with open(f"{OUT_DIR}/gini_data.json", 'w') as f:
        json.dump(result, f, separators=(',', ':'))
    print(f"  → gini_data.json ({len(df)} TFs)")


# ── 5. PCA permutation test ──────────────────────────────────────────────────

def prepare_permutation():
    print("Preparing permutation data...")
    df = pd.read_csv(PERM_CSV)

    result = {
        'pc': df['PC'].tolist(),
        'observed': [round(v, 6) for v in df['observed_var_explained'].tolist()],
        'null_mean': [round(v, 8) for v in df['null_mean'].tolist()],
        'null_std': [float(f"{v:.2e}") for v in df['null_std'].tolist()],
        'z_score': [round(v, 1) for v in df['z_score'].tolist()],
        'p_value': [round(v, 4) for v in df['p_permutation'].tolist()],
    }

    with open(f"{OUT_DIR}/permutation_data.json", 'w') as f:
        json.dump(result, f, separators=(',', ':'))
    print(f"  → permutation_data.json ({len(df)} PCs)")


# ── 6. Bulk vs SC concordance ────────────────────────────────────────────────

def prepare_concordance():
    print("Preparing concordance data...")
    df = pd.read_csv(CONC_CSV)

    records = []
    for _, row in df.iterrows():
        rec = {
            'tf': row['tf'],
            'source': row['source'],
            'family': row['tf_family'] if pd.notna(row['tf_family']) else 'Unknown',
            'role': row['biological_role'] if pd.notna(row['biological_role']) else '',
        }
        if pd.notna(row.get('bulk_delta_prevalence')):
            rec['bulk_delta'] = round(row['bulk_delta_prevalence'], 3)
        if pd.notna(row.get('bulk_pc')):
            rec['bulk_pc'] = row['bulk_pc']
        if pd.notna(row.get('bulk_direction')):
            rec['bulk_dir'] = row['bulk_direction']
        if pd.notna(row.get('sc_gini')):
            rec['sc_gini'] = round(row['sc_gini'], 4)
        if pd.notna(row.get('sc_top_cell_type')):
            rec['sc_top'] = row['sc_top_cell_type']
        if pd.notna(row.get('sc_max_hit_rate')):
            rec['sc_max_hr'] = round(row['sc_max_hit_rate'], 4)
        records.append(rec)

    with open(f"{OUT_DIR}/concordance_data.json", 'w') as f:
        json.dump(records, f, separators=(',', ':'))
    print(f"  → concordance_data.json ({len(records)} TFs)")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    prepare_umap()
    prepare_jsd()
    prepare_jaccard()
    prepare_gini()
    prepare_permutation()
    prepare_concordance()
    print("\nAll data files prepared.")
