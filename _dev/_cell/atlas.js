import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, mix, makePerlin, makeFbm, lin, buildEnvironment } from './lib.js';
import '../../palettes.js';

/* Bakes the cell sprite atlas the scroll canvas blits from.

   The cells in the sequence are whole cells packed into a mass, not the
   cut-away hero, so what is baked here is a closed shell: a displaced sphere
   with the nucleus showing through the front of it. The camera is orthographic
   because every sprite has to be the same projection no matter where the cell
   lands on screen.

   Layout is one row per palette, one column per outline variant, which is the
   same (palette, variant) pair the runtime cache is keyed on. */

const qs = new URLSearchParams(location.search);
const num = (k, d) => { const v = parseFloat(qs.get(k)); return Number.isFinite(v) ? v : d; };

const TILE = num('tile', 256);
// supersample factor: rendered large and drawn down, which is the whole of the
// antialiasing here since there is no post chain
const SS = num('ss', 2);
const ROWS_ARG = qs.get('pals');

const noise = makePerlin(1337);
const fbm = makeFbm(noise);

/* Row index is the palette id the runtime looks up, so the order here is the
   order in the shared table and nowhere else. */
const PALETTES = globalThis.CELL_PALETTES.all;

/* Outline wobble and nucleus placement, matching the variants the sequence
   already seeds cells with, so a lineage keeps the body it had. */
const SHAPES = [
    { amp: 0.018, lobes: 4, ph: 0.4, nx: 0.13, ny: 0.06, nr: 0.34 },
    { amp: 0.024, lobes: 5, ph: 2.1, nx: -0.06, ny: 0.15, nr: 0.32 },
    { amp: 0.015, lobes: 3, ph: 3.9, nx: 0.16, ny: -0.03, nr: 0.36 },
    { amp: 0.021, lobes: 4, ph: 5.2, nx: 0.02, ny: -0.13, nr: 0.31 },
    { amp: 0.013, lobes: 6, ph: 1.2, nx: -0.14, ny: -0.05, nr: 0.35 }
];

const rows = ROWS_ARG === null ? PALETTES : ROWS_ARG.split(',').map(i => PALETTES[+i]);
const COLS = SHAPES.length;

// the sprite is drawn at radius * SPAN * 2, so the cell has to sit inside the
// tile at exactly that fraction or every cell lands the wrong size on screen
const PAD = 0.18;
const SPAN = 1 + PAD;

const atlas = document.getElementById('atlas');
atlas.width = COLS * TILE;
atlas.height = rows.length * TILE;
atlas.style.width = (COLS * TILE) + 'px';
atlas.style.height = (rows.length * TILE) + 'px';
const actx = atlas.getContext('2d');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(1);
renderer.setSize(TILE * SS, TILE * SS);
renderer.setClearAlpha(0);
/* No filmic curve here, unlike the hero still. These sprites have to land on
   the palette the rest of the sequence is written in, and ACES lifts and
   desaturates the midtones enough that a cell whose albedo is exactly the
   palette's body colour comes out a paler, greyer blue than everything else on
   the page. Keeping it linear means the light is the only thing between the
   palette and the pixel, so the peak just has to be kept off the ceiling. */
renderer.toneMapping = num('tm', 0) ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
renderer.toneMappingExposure = num('exp', 1.0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.id = 'gl';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.OrthographicCamera(-SPAN, SPAN, SPAN, -SPAN, 0.1, 20);
camera.position.set(0, 0, 6);
camera.lookAt(0, 0, 0);

/* A cool neutral room. Per-palette warmth comes from the material colours and
   from a dim ambient tinted with that palette's shadow tone, rather than from
   re-baking the environment once per palette. */
scene.environment = buildEnvironment(renderer, {
    room: [0.26, 0.28, 0.32], ceiling: [0.46, 0.49, 0.55], floor: [0.10, 0.11, 0.14],
    key: [1.00, 0.99, 0.97]
});
scene.environmentIntensity = num('envi', 0.18);

// upper left and in front, which is where the sequence's own key already is
const key = new THREE.DirectionalLight(0xfff6ea, num('keyi', 1.00));
key.position.set(-2.6, 3.4, 2.6);
scene.add(key);

const rim = new THREE.DirectionalLight(0xcfe0ff, num('rimi', 0.22));
rim.position.set(2.6, -0.4, -1.4);
scene.add(rim);

const shadowTint = new THREE.HemisphereLight(0xffffff, 0xffffff, 0);
scene.add(shadowTint);

// the key in sprite space, y up
const L = new THREE.Vector3(-0.40, 0.54, 0.74).normalize();

const RELIEF = num('relief', 1);
const MOTT = num('mott', 1);

/* Broad undulation, and very little above it. The fine octaves that read as
   detail on a hero still turn into orange peel once the same surface is only
   sixty pixels across, and a hundred of them together look like gravel. */
function relief(d, seed) {
    return 1 + RELIEF * (
        0.034 * fbm(d.x * 2.0 + seed, d.y * 2.0 - 4 + seed, d.z * 2.0 + 7, 3)
        + 0.006 * fbm(d.x * 4.2 + 2 + seed, d.y * 4.2 + 5, d.z * 4.2 - 3 + seed, 2)
        + 0.0010 * fbm(d.x * 9 - 6, d.y * 9 + 1 + seed, d.z * 9 + 9, 2));
}

const srgb = c => lin((c[0] << 16) | (c[1] << 8) | c[2]);

/* One cell: a displaced sphere whose vertex colours carry both the membrane's
   own mottling and the nucleus seen through the front of it.

   Doing the nucleus in the albedo rather than as a second mesh behind a
   transmissive membrane keeps the sprite fully opaque, which matters because
   these overlap each other by the hundred: a genuinely translucent cell would
   let the cells behind it show through and the mass would turn to soup. */
function buildCell(pal, shape, malignant) {
    const geo = mergeVertices(new THREE.IcosahedronGeometry(1, num('detail', 6)));
    const pos = geo.attributes.position;
    const seed = shape.ph * 13.7;

    const amp = shape.amp * (malignant ? 1.3 : 1);
    const nr = shape.nr * (malignant ? 1.15 : 1) * num('nucr', 1.15);
    // the nucleus sits below the front surface, close enough that the
    // cytoplasm over it stays thin and it does not wash out
    const ncx = shape.nx, ncy = -shape.ny, ncz = num('nucz', 0.30);

    /* Sunk slightly toward the shadow tone. The sprite is lit near enough to
       full over most of its face, so an albedo of exactly the palette's body
       colour comes back lighter than that colour, and the opening cell — the
       one cell on screen, and the only one the cluster shading never darkens —
       is where that shows as a pale ball. */
    const sink = num('sink', 0.10);
    const mid = srgb(pal.mid), low = srgb(pal.deep);
    const body = new THREE.Color(
        mix(mid.r, low.r, sink), mix(mid.g, low.g, sink), mix(mid.b, low.b, sink));
    const lift = srgb(pal.core);

    /* The nucleus is denser than the cytoplasm, so it is carried most of the
       way toward the palette's deepest tone and then darkened again.

       The extra darkening is the part that has no equivalent in the flat
       sprite: there the nucleus separated because the cytoplasm around it was
       shaded up toward the palette's lightest tone while the nucleus stayed
       flat. Here both are albedo under the same light, and mixing nuc toward
       deep lands within a few percent of mid in linear space, so without this
       the nucleus disappears into the body entirely. */
    const nd = num('nucd', 0.22);
    const nm = num('nucmix', 0.50);
    const nBase = srgb(pal.nuc), nDeep = srgb(pal.deep);
    const nucCol = new THREE.Color(
        mix(nBase.r, nDeep.r, nm) * nd,
        mix(nBase.g, nDeep.g, nm) * nd,
        mix(nBase.b, nDeep.b, nm) * nd
    );

    const col = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const d = v.clone().normalize();

        /* Outline wobble taken in the view plane, so it shows in silhouette.
           It has to be weighted off toward the poles: the angle it is a
           function of is singular on the view axis, and the camera looks
           straight down it, so an unweighted wobble pinches every lobe into
           the middle of the cell as a starburst. rho^2 is 1 at the silhouette,
           where the wobble is the whole point, and 0 where it is undefined. */
        const rho2 = d.x * d.x + d.y * d.y;
        const ang = Math.atan2(d.y, d.x);
        const edge = 1 + rho2 * (
            amp * Math.sin(ang * shape.lobes + shape.ph)
            + amp * 0.5 * Math.sin(ang * (shape.lobes + 2) - shape.ph));
        const r = relief(d, seed) * edge;
        v.copy(d).multiplyScalar(r);
        pos.setXYZ(i, v.x, v.y, v.z);

        // mottling, so a field of these does not read as one cell stamped out
        const mott = 1 + MOTT * 0.10 * fbm(d.x * 4.3 + 21 + seed, d.y * 4.3 + 13, d.z * 4.3 - 8, 3);
        const t = num('lift', 0);
        let cr = mix(body.r, lift.r, t) * mott;
        let cg = mix(body.g, lift.g, t) * mott;
        let cb = mix(body.b, lift.b, t) * mott;

        /* Taken against the ideal sphere rather than the displaced surface.
           Run off the relief instead and its noise modulates the depth of
           cytoplasm over the nucleus, which the exponential then clips against
           its own ceiling: the nucleus comes out as a ragged star of plateaus
           rather than a body. */
        const qx = d.x - ncx, qy = d.y - ncy;
        const q2 = qx * qx + qy * qy;
        if (q2 < nr * nr) {
            const mz = Math.sqrt(nr * nr - q2);
            // how much cytoplasm is still in front of the nucleus here: thin
            // over its centre, thick at its edge, so it fades into the body
            // instead of ending on a line
            const above = Math.max(0, d.z - (ncz + mz));
            const att = Math.min(0.86, Math.exp(-1.7 * above) * 1.55);
            const ndl = (qx * L.x + qy * L.y) / nr + (mz / nr) * L.z;
            // barely directional: light reaching the nucleus has scattered
            // through the cytoplasm, and a hard gradient here makes it read as
            // a bump sitting on the cell rather than a body inside it
            const ms = 0.66 + 0.32 * (ndl > -0.5 ? (ndl + 0.5) / 1.5 : 0);
            cr = mix(cr, nucCol.r * ms, att);
            cg = mix(cg, nucCol.g * ms, att);
            cb = mix(cb, nucCol.b * ms, att);
        } else {
            // the nucleus blocking internal light leaves a soft seat around
            // itself, so it looks embedded and not printed on
            const o = Math.exp(-(Math.sqrt(q2) - nr) * 5) * num('seat', 0.45);
            cr *= 1 - o; cg *= 1 - o; cb *= 1 - o;
        }

        col[i * 3] = cr; col[i * 3 + 1] = cg; col[i * 3 + 2] = cb;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: num('rough', 0.62),
        metalness: 0,
        clearcoat: num('coat', 0.14),
        clearcoatRoughness: 0.5,
        sheen: num('sheen', 0.10),
        sheenRoughness: 0.85,
        sheenColor: srgb(pal.edge),
        envMapIntensity: num('menv', 0.30)
    });

    return new THREE.Mesh(geo, mat);
}

let current = null;

for (let row = 0; row < rows.length; row++) {
    const pal = rows[row];
    const malignant = pal.id !== 0;

    // the palette's shadow tone as a dim ambient, so a cell's dark side falls
    // into its own colour rather than into the same grey for every clone
    shadowTint.groundColor = srgb(pal.deep);
    shadowTint.color = srgb(pal.deep);
    shadowTint.intensity = num('shadowi', 0.38);

    for (let colIdx = 0; colIdx < COLS; colIdx++) {
        if (current) {
            scene.remove(current);
            current.geometry.dispose();
            current.material.dispose();
        }
        current = buildCell(pal, SHAPES[colIdx], malignant);
        scene.add(current);
        renderer.render(scene, camera);

        /* The contact shadow lives in the sprite's own padding, pushed away
           from the light so it reads as cast by the cell onto whatever is
           behind it rather than as a halo around it. Hundreds of these
           overlapping is most of what gives the mass its depth. */
        actx.save();
        actx.shadowColor = `rgba(4,9,18,${num('shadowa', 0.5)})`;
        actx.shadowBlur = TILE * 0.045;
        actx.shadowOffsetX = TILE * 0.035;
        actx.shadowOffsetY = TILE * 0.042;
        actx.drawImage(renderer.domElement, 0, 0, TILE * SS, TILE * SS,
            colIdx * TILE, row * TILE, TILE, TILE);
        actx.restore();
    }
}

/* There is no webp encoder on the machine this is baked on, but the browser
   doing the rendering is one. With alpha and this much smooth gradient it
   comes out around a fifth of the PNG, so the atlas is encoded here and lifted
   back out of the DOM rather than screenshotted. */
const ENC = qs.get('enc');
if (ENC) {
    const url = atlas.toDataURL('image/' + ENC, num('q', 0.92));
    document.getElementById('out').textContent = url.slice(url.indexOf(',') + 1);
}

document.title = `atlas ${COLS}x${rows.length} @${TILE}`;
