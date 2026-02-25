/**
 * DNA Secondary Structure Prediction & Visualization
 * Ported from Origin Workbench for Static Site
 */

// --- Constants ---
const SEQUENCE_DATA = {
    id: 'pELS_HepG2_dnase_high_-1_10000796',
    sequence: 'GAATAGCTTCCAATCCTCACGGTGTGCTGTGTCTGGGCACGTTGAACAGAAAATCCTTGTCAACAACCTTGATCAAACATCCAAGCAGGGACGCGTCAGGAGCAATCTGATTGTTTTTGCATGTGGGAGGCGTACATTTCCCCCTGGCTGCCTACCTGCTTTGATTGGCTCGGGAGAGTGGTGTAGCTGGGGAGGGGGCG',
    cellType: 'HepG2',
    length: 200,
    category: 'Enhancer'
};

// Motifs from moods_hits_detailed.csv for this sequence
const MOTIFS = [
    { name: 'ARNT::HIF1A', start: 37, end: 45 },
    { name: 'CTCFL', start: 191, end: 205 },
    { name: 'DUXA', start: 160, end: 173 },
    { name: 'ETV2::ONECUT2', start: 149, end: 166 },
    { name: 'GFI1', start: 156, end: 168 },
    { name: 'HIF1A', start: 36, end: 46 },
    { name: 'INSM1', start: 137, end: 149 },
    { name: 'KLF1', start: 188, end: 197 },
    { name: 'KLF10', start: 188, end: 199 },
    { name: 'KLF12', start: 188, end: 197 },
    { name: 'KLF14', start: 188, end: 202 },
    { name: 'KLF17', start: 168, end: 183 },
    { name: 'KLF5', start: 188, end: 198 },
    { name: 'MAZ', start: 188, end: 199 },
    { name: 'MEIS1', start: 57, end: 64 }
];

// TF Colors from constants.ts
const TF_COLORS = [
  '#dc2626', '#2563eb', '#059669', '#d97706', '#7c3aed',
  '#db2777', '#0891b2', '#65a30d', '#ea580c', '#6366f1',
  '#be123c', '#0d9488', '#ca8a04', '#4f46e5', '#16a34a',
  '#e11d48', '#0284c7', '#84cc16', '#c026d3', '#14b8a6',
  '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#a855f7',
  '#10b981', '#f97316', '#3b82f6', '#ec4899', '#22c55e',
];

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getTfColor(tfName) {
  let hash = 0;
  for (let i = 0; i < tfName.length; i++) {
    hash = ((hash << 5) - hash + tfName.charCodeAt(i)) | 0;
  }
  const hex = TF_COLORS[Math.abs(hash) % TF_COLORS.length];
  return hexToRgba(hex, 0.4); // Muted opacity
}

// --- Sequence Rendering Logic ---

function renderSequence() {
    const container = document.getElementById('seq-display');
    if (!container) return;

    const seq = SEQUENCE_DATA.sequence;
    const CHUNK_SIZE = 10;
    const numChunks = Math.ceil(seq.length / CHUNK_SIZE);
    
    // Build highlight map
    const highlightMap = new Map();
    MOTIFS.forEach(m => {
        const color = getTfColor(m.name);
        for (let pos = m.start; pos < m.end; pos++) {
            // Simple overlay: last motif wins (or could blend, but simple is fine)
            highlightMap.set(pos, { name: m.name, color });
        }
    });

    let html = '';

    for (let c = 0; c < numChunks; c++) {
        const chunkStart = c * CHUNK_SIZE;
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, seq.length);
        const label = chunkStart + 1;
        
        let basesHtml = '';
        for (let i = chunkStart; i < chunkEnd; i++) {
            const char = seq[i];
            const highlight = highlightMap.get(i);
            
            if (highlight) {
                // Use the RGBA color for background, and keep text dark for readability on light bg
                basesHtml += `<span style="background-color: ${highlight.color}; color: #1c1917; font-weight: 700; border-radius: 2px; cursor: help;" title="${highlight.name}">${char}</span>`;
            } else {
                basesHtml += `<span>${char}</span>`;
            }
        }

        html += `
            <div class="seq-chunk">
                <span class="chunk-label">${label}</span>
                <span class="chunk-bases">${basesHtml}</span>
            </div>
        `;
    }

    container.innerHTML = html;
}

// --- 3D Generation Logic (S3 Fetch) ---

const S3_BASE = 'https://origin-workbench-public-3dstructures.s3.us-east-2.amazonaws.com/protenix-dsdna-3dstructures';
const LIB_URL = 'https://3Dmol.org/build/3Dmol-min.js';

function load3DmolScript() {
    if (typeof $3Dmol !== 'undefined') return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = LIB_URL;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load 3Dmol.js'));
        document.head.appendChild(s);
    });
}

async function initStructureViewer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #a8a29e; font-size: 14px; font-weight: 500;">Loading 3D Structure...</div>';

    const sequenceId = SEQUENCE_DATA.id;
    const cifUrl = `${S3_BASE}/${encodeURIComponent(sequenceId)}.cif`;

    try {
        const [cifData] = await Promise.all([
            fetch(cifUrl).then(r => {
                if (!r.ok) throw new Error(`Structure fetch failed: ${r.statusText}`);
                return r.text();
            }),
            load3DmolScript(),
        ]);

        container.innerHTML = '';

        const viewer = $3Dmol.createViewer(container, {
            backgroundColor: '#ffffff',
            antialias: false,
        });

        viewer.addModel(cifData, 'cif');

        const plddtColor = (atom) => {
            const bfactor = atom.b || 0;
            if (bfactor > 90) return '#1e40af';
            if (bfactor > 70) return '#60a5fa';
            if (bfactor > 50) return '#fbbf24';
            return '#f97316';
        };

        viewer.setStyle({}, {
            cartoon: {
                colorfunc: plddtColor,
                thickness: 0.4,
                opacity: 0.9,
            },
        });

        viewer.zoomTo();
        viewer.zoom(1.05);
        viewer.spin('y', 0.4);
        viewer.render();

        window.structureViewer = viewer;
        window.structureViewer.isSpinning = true;

        function passScrollThrough(e) {
            e.stopPropagation();
            e.stopImmediatePropagation();
            window.scrollBy(0, e.deltaY);
        }
        container.addEventListener('wheel', passScrollThrough, { passive: true, capture: true });

        const canvasEl = container.querySelector('canvas');
        if (canvasEl) {
            canvasEl.addEventListener('wheel', passScrollThrough, { passive: true, capture: true });
        }

    } catch (err) {
        console.error(err);
        container.innerHTML = '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #dc2626; font-size: 14px; font-weight: 500;">Error loading structure</div>';
    }
}

// Controls
function toggleSpin() {
    if (!window.structureViewer) return;
    const btn = document.getElementById('btn-spin');
    if (window.structureViewer.isSpinning) {
        window.structureViewer.spin(false);
        window.structureViewer.isSpinning = false;
        btn.classList.remove('active');
        btn.textContent = 'Paused';
    } else {
        window.structureViewer.spin('y', 0.4);
        window.structureViewer.isSpinning = true;
        btn.classList.add('active');
        btn.textContent = 'Spinning';
    }
}

function resetView() {
    if (!window.structureViewer) return;
    window.structureViewer.zoomTo();
    window.structureViewer.zoom(0.9);
}

// Initialize: render sequence immediately, defer heavy 3D work
document.addEventListener('DOMContentLoaded', () => {
    renderSequence();

    const startViewer = () => initStructureViewer('structure-canvas');
    if ('requestIdleCallback' in window) {
        requestIdleCallback(startViewer, { timeout: 1500 });
    } else {
        setTimeout(startViewer, 0);
    }
});
