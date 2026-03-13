#!/usr/bin/env python3
"""
Rebuild pca_explorer_data.json gene callouts using transcript-level TSSes
from GENCODE GTF instead of gene-level TSSes.

Usage:
    cd /home/username/yrraadi-io.github.io/blogs/training-data
    python3 rebuild_callouts.py
"""
import gzip, json, heapq, csv, bisect
from collections import defaultdict

GENCODE_GTF = "/home/username/projects/ccre_pca/data/gencode.gtf.gz"
CCRE_REGISTRY = "/home/username/projects/ccre_pca/data/ccre_registry.tsv"
LOADINGS_CSV = "/home/username/projects/ccre_pca/results/quantitative_pca/pca_loadings.csv"
AXIS_CCRES_DIR = "/home/username/projects/ccre_pca/results/axis_ccres"
TOP_CCRES_CSV = "/home/username/projects/ccre_pca/results/top_ccres_with_genes.csv"
PCA_EXPLORER_JSON = "pca_explorer_data.json"

TOP_N = 50  # top cCREs per side per PC to check for nearest gene

# ── Step 1: Extract transcript-level TSSes from GENCODE GTF ──────────
print("Step 1: Extracting transcript-level TSSes from GENCODE GTF...")
# Store as {chrom: sorted list of (tss_pos, gene_name)}
tss_by_chrom = defaultdict(list)
n_tx = 0
with gzip.open(GENCODE_GTF, 'rt') as f:
    for line in f:
        if line.startswith('#'):
            continue
        parts = line.rstrip('\n').split('\t')
        if parts[2] != 'transcript':
            continue
        chrom = parts[0]
        strand = parts[6]
        start = int(parts[3])  # 1-based
        end = int(parts[4])
        tss = start if strand == '+' else end

        # Extract gene_name from attributes
        attrs = parts[8]
        gn = None
        for attr in attrs.split(';'):
            attr = attr.strip()
            if attr.startswith('gene_name'):
                gn = attr.split('"')[1]
                break
        # Extract gene_type — only keep protein-coding transcripts
        gt = None
        for attr in attrs.split(';'):
            attr = attr.strip()
            if attr.startswith('gene_type'):
                gt = attr.split('"')[1]
                break
        if gn and gt == 'protein_coding':
            tss_by_chrom[chrom].append((tss, gn))
            n_tx += 1

# Sort each chrom by TSS position for binary search
for chrom in tss_by_chrom:
    tss_by_chrom[chrom].sort()

print(f"  Loaded {n_tx:,} transcript TSSes across {len(tss_by_chrom)} chromosomes")

# ── Step 2: Load cCRE registry (ID → chrom, start, end, type) ───────
print("Step 2: Loading cCRE registry...")
ccre_info = {}  # short_id → (chrom, start, end, type)
with open(CCRE_REGISTRY) as f:
    for line in f:
        parts = line.rstrip('\n').split('\t')
        if len(parts) < 6:
            continue
        chrom, start, end, detail_id, short_id, ccre_type = parts[0], int(parts[1]), int(parts[2]), parts[3], parts[4], parts[5]
        ccre_info[short_id] = (chrom, start, end, ccre_type)
        ccre_info[detail_id] = (chrom, start, end, ccre_type)
print(f"  Loaded {len(ccre_info):,} cCRE entries")

# ── Step 3: Nearest-gene function using transcript-level TSSes ───────
def find_nearest_gene(chrom, start, end):
    """Find nearest transcript TSS to the midpoint of a cCRE."""
    tss_list = tss_by_chrom.get(chrom, [])
    if not tss_list:
        return None, None
    mid = (start + end) // 2
    # Binary search for closest TSS
    positions = [t[0] for t in tss_list]
    idx = bisect.bisect_left(positions, mid)
    best_dist = float('inf')
    best_gene = None
    for i in [idx - 1, idx, idx + 1]:
        if 0 <= i < len(tss_list):
            dist = abs(tss_list[i][0] - mid)
            if dist < best_dist:
                best_dist = dist
                best_gene = tss_list[i][1]
    return best_gene, best_dist

# ── Step 4: Get top cCREs per PC from loadings matrix ────────────────
print("Step 3: Reading PCA loadings header...")
with open(LOADINGS_CSV) as f:
    reader = csv.reader(f)
    header = next(reader)
# header[0] is cCRE id, rest are PC1..PC50
pc_cols = {h: i for i, h in enumerate(header)}

# Clean PCs (exclude PC3, PC6)
clean_pcs = [f'PC{i}' for i in range(1, 31) if i not in (3, 6)]

print("Step 4: Streaming through loadings to find top cCREs per PC...")
# For each PC, keep top TOP_N positive and top TOP_N negative loading cCREs
# Using min-heaps: for positive, heap of (loading, id); for negative, heap of (-loading, id)
pos_heaps = {pc: [] for pc in clean_pcs}
neg_heaps = {pc: [] for pc in clean_pcs}

with open(LOADINGS_CSV) as f:
    reader = csv.reader(f)
    next(reader)  # skip header
    for row_num, row in enumerate(reader):
        if row_num % 100000 == 0:
            print(f"  Row {row_num:,}...")
        ccre_id = row[0]
        for pc in clean_pcs:
            val = float(row[pc_cols[pc]])
            # Positive heap (min-heap, keep largest)
            if len(pos_heaps[pc]) < TOP_N:
                heapq.heappush(pos_heaps[pc], (val, ccre_id))
            elif val > pos_heaps[pc][0][0]:
                heapq.heapreplace(pos_heaps[pc], (val, ccre_id))
            # Negative heap (keep most negative = smallest)
            neg_val = -val
            if len(neg_heaps[pc]) < TOP_N:
                heapq.heappush(neg_heaps[pc], (neg_val, ccre_id))
            elif neg_val > neg_heaps[pc][0][0]:
                heapq.heapreplace(neg_heaps[pc], (neg_val, ccre_id))

print(f"  Done. Processed {row_num + 1:,} cCREs")

# ── Step 5: Map top cCREs to nearest genes ───────────────────────────
print("Step 5: Mapping top cCREs to nearest transcript-level TSSes...")

gene_callouts = {}
for pc in clean_pcs:
    pos_results = []
    neg_results = []

    # Process positive side
    for loading, ccre_id in sorted(pos_heaps[pc], reverse=True):
        info = ccre_info.get(ccre_id)
        if not info:
            continue
        chrom, start, end, ccre_type = info
        # Include all cCRE types
        gene, dist = find_nearest_gene(chrom, start, end)
        if gene and dist is not None:
            # Deduplicate by gene name
            if gene not in [r['gene'] for r in pos_results]:
                pos_results.append({'gene': gene, 'dist': dist, 'type': ccre_type})
        if len(pos_results) >= 3:
            break

    # Process negative side
    for neg_loading, ccre_id in sorted(neg_heaps[pc], reverse=True):
        info = ccre_info.get(ccre_id)
        if not info:
            continue
        chrom, start, end, ccre_type = info
        if ccre_type not in ('PLS', 'pELS'):
            continue
        gene, dist = find_nearest_gene(chrom, start, end)
        if gene and dist is not None:
            if gene not in [r['gene'] for r in neg_results]:
                neg_results.append({'gene': gene, 'dist': dist, 'type': ccre_type})
        if len(neg_results) >= 3:
            break

    gene_callouts[pc] = {'pos': pos_results, 'neg': neg_results}
    print(f"  {pc}: pos={[r['gene']+'('+str(r['dist'])+'bp)' for r in pos_results]}  neg={[r['gene']+'('+str(r['dist'])+'bp)' for r in neg_results]}")

# ── Step 6: Update the JSON file ─────────────────────────────────────
print("Step 6: Updating pca_explorer_data.json...")
with open(PCA_EXPLORER_JSON) as f:
    data = json.load(f)

data['gene_callouts'] = gene_callouts

with open(PCA_EXPLORER_JSON, 'w') as f:
    json.dump(data, f, separators=(',', ':'))

print(f"Done. Updated {PCA_EXPLORER_JSON} ({len(json.dumps(data, separators=(',',':'))):,} bytes)")

# Spot-check: FOSL2 on PC1
gc1 = gene_callouts.get('PC1', {})
print(f"\nSpot check — PC1 pos: {gc1.get('pos', [])}")
print(f"Spot check — PC1 neg: {gc1.get('neg', [])}")
