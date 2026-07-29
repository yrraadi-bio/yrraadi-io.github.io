import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    TAU, clamp, mix, smoothstep, mulberry32, makePerlin, makeFbm,
    lin, untonemap, buildEnvironment
} from './lib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* A cut-away cell, rendered offline for use as a still asset.

   Everything is built from procedural geometry so the whole look is a set of
   numbers in this file: the opening is a real hole in a shell with wall
   thickness rather than a flat mask, and the surface relief is displaced
   vertices rather than a normal map, so the silhouette breaks up too. */

const qs = new URLSearchParams(location.search);

/* Named looks, so a finished asset is one word rather than a wall of query
   parameters. Anything in the URL still wins over the preset. */
const LOOKS = {
    // the warm, fully dressed cell: receptors, cortical tangle, cream studio
    hero: {},
    // the site's palette, stripped to membrane, aster and nucleus
    quiet: {
        pal: 'navy', knobs: 0, pores: 0, mesh: 0,
        aster: 180, filr: 1.15,
        keyi: 2.4, rimi: 0.55, envi: 0.72, exp: 0.95,
        menv: 0.42, cenv: 0.42, mott: 0.028, relief: 0.9, grain: 0.4
    }
};

const LOOK = LOOKS[qs.get('look')] || {};
const setting = k => (qs.has(k) ? qs.get(k) : LOOK[k]);
const num = (k, d) => { const v = parseFloat(setting(k)); return Number.isFinite(v) ? v : d; };
const on = (k, d) => { const v = setting(k); return v === undefined ? d : String(v) !== '0'; };

const W = num('w', 900);
const H = num('h', 900);
const DPR = num('dpr', 1);
const Q = num('q', 1);
const t0 = performance.now();

const noise = makePerlin(1337);
const rnd = mulberry32(90210);
const fbm = makeFbm(noise);

/* ---------- palettes ---------- */

const PALETTES = {
    // the textbook reading: warm membrane, contrasting receptors
    warm: {
        bg: 0xf5f0e8,
        outer: 0xd4ac2b, inner: 0xc06a05, lip: 0xb08f1e,
        knob: 0x3f8ed2, pore: 0x4f9ada,
        filPale: 0xd3ecf8, filMid: 0x54b3e4, filDeep: 0x2f92cd,
        nuc: 0xe4756a,
        room: [0.30, 0.29, 0.28], ceiling: [0.52, 0.51, 0.50], floor: [0.15, 0.13, 0.11],
        key: [1.00, 0.98, 0.94], keyLight: 0xfff2dc, bounceLight: 0xffd9a8
    },
    // one material, one accent: the receptors sit in the membrane's own family
    // so the object reads as a form rather than as a labelled diagram
    bone: {
        bg: 0xefe9df,
        outer: 0xdfd0b4, inner: 0xa8845a, lip: 0xcdbc9d,
        knob: 0xcbb794, pore: 0xc0aa85,
        filPale: 0xf2ece0, filMid: 0xc9b494, filDeep: 0x9c8360,
        nuc: 0xcf7f66,
        room: [0.30, 0.29, 0.28], ceiling: [0.52, 0.51, 0.50], floor: [0.15, 0.13, 0.11],
        key: [1.00, 0.98, 0.94], keyLight: 0xfff2dc, bounceLight: 0xffd9a8
    },
    // the site's own palette, lit as a dark subject
    navy: {
        bg: 0x07101d,
        // the cavity is given its own hue rather than a darker version of the
        // wall, so the inside of the shell reads as a decision and not as an
        // absence of light
        outer: 0x1b3d68, inner: 0x142654, lip: 0x2a568c,
        knob: 0x7fb4ff, pore: 0x8fbdff,
        filPale: 0xbdd8f7, filMid: 0x6fa4ee, filDeep: 0x38639f,
        nuc: 0xff7aa8,
        room: [0.10, 0.13, 0.19], ceiling: [0.22, 0.29, 0.42], floor: [0.03, 0.05, 0.09],
        key: [0.92, 0.96, 1.00], keyLight: 0xdceaff, bounceLight: 0x2a4a7a,
        rimLight: 0x9ec4ff
    }
};

const P = PALETTES[setting('pal')] || PALETTES.warm;

/* ---------- scene ---------- */

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
renderer.setPixelRatio(DPR);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exp', 1.0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

scene.background = untonemap(lin(P.bg), renderer.toneMappingExposure);

const camera = new THREE.PerspectiveCamera(num('fov', 30), W / H, 0.5, 20);
camera.position.set(num('cx', 0.06), num('cy', 0.62), num('cz', 5.05));
camera.lookAt(0, num('ly', -0.02), 0);

/* ---------- environment ---------- */

scene.environment = buildEnvironment(renderer, P);
scene.environmentIntensity = num('envi', 0.9);

const key = new THREE.DirectionalLight(P.keyLight, num('keyi', 3.0));
key.position.set(-2.6, 3.6, 2.3);
key.castShadow = true;
key.shadow.mapSize.set(num('shadow', 2048), num('shadow', 2048));
key.shadow.camera.left = -1.5;
key.shadow.camera.right = 1.5;
key.shadow.camera.top = 1.5;
key.shadow.camera.bottom = -1.5;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 12;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.012;
key.shadow.radius = 3;
scene.add(key);

// on a dark ground the silhouette needs its own edge, or the form dissolves
// into the background wherever the key does not reach
const rimLight = new THREE.DirectionalLight(P.rimLight || 0xd8e6ff, num('rimi', 0.35));
rimLight.position.set(2.8, 0.6, -1.6);
scene.add(rimLight);

// warm bounce off the surface the cell is notionally sitting over, so the
// underside falls into colour rather than into grey
const bounce = new THREE.DirectionalLight(P.bounceLight, num('bouncei', 0.42));
bounce.position.set(0.9, -2.4, 1.6);
scene.add(bounce);

/* ---------- membrane ---------- */

const R = 1.0;
const WALL = num('wall', 0.076);

// the opening faces up and toward the camera, so the cavity is seen into
const AXIS = new THREE.Vector3(num('ax', -0.11), num('ay', 0.72), num('az', 0.68)).normalize();
const UP = Math.abs(AXIS.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
const EU = new THREE.Vector3().crossVectors(UP, AXIS).normalize();
const EV = new THREE.Vector3().crossVectors(AXIS, EU).normalize();

const TH0 = num('cut', 0.86);

// angular radius of the removed cap, wobbled so the rim is not a clean circle
function cutAt(phi) {
    return TH0
        + 0.090 * Math.sin(phi + 0.7)
        + 0.052 * Math.sin(2 * phi + 2.3)
        + 0.026 * Math.sin(3 * phi - 1.1);
}

function dirAt(phi, theta, out) {
    const st = Math.sin(theta), ct = Math.cos(theta);
    const cp = Math.cos(phi), sp = Math.sin(phi);
    return out.set(
        AXIS.x * ct + (EU.x * cp + EV.x * sp) * st,
        AXIS.y * ct + (EU.y * cp + EV.y * sp) * st,
        AXIS.z * ct + (EU.z * cp + EV.z * sp) * st
    );
}

/* Surface relief: broad swells plus a fine orange-peel grain. The broad term
   carries the silhouette and the fine ones only catch light, so they are
   scaled apart: with no receptors on the wall the grain has nothing to
   compete with and turns the membrane into crumpled foil. */
function relief(d) {
    const broad = num('relief', 1);
    const fine = num('grain', 1);
    return 1
        + 0.036 * broad * fbm(d.x * 2.6 + 11, d.y * 2.6 - 4, d.z * 2.6 + 7, 3)
        + 0.013 * fine * fbm(d.x * 7.4 + 2, d.y * 7.4 + 5, d.z * 7.4 - 3, 2)
        + 0.0055 * fine * fbm(d.x * 19 - 6, d.y * 19 + 1, d.z * 19 + 9, 2)
        + 0.0022 * fine * fbm(d.x * 44 + 3, d.y * 44 - 9, d.z * 44 + 2, 2);
}

/* One continuous strip runs inner wall -> bottom -> outer wall -> around the
   lip and back, so the shell is a single closed surface and its normals stay
   consistent across the cut edge instead of meeting at a hard seam. */
function buildMembrane() {
    const NPHI = Math.max(64, Math.round(300 * Q));
    const NA = Math.max(24, Math.round(110 * Q));   // inner wall
    const NB = Math.max(24, Math.round(110 * Q));   // outer wall
    const NC = Math.max(4, Math.round(9 * Q));      // lip
    const NROW = NA + NB + NC;

    const count = NPHI * (NROW + 1);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);

    const dbgParts = on('parts', false);
    const outerCol = dbgParts ? lin(0x2040ff) : lin(P.outer);
    const innerCol = dbgParts ? lin(0x00ff40) : lin(P.inner);
    // the lip faces straight up into the brightest part of the room, so it
    // needs to sit below the outer wall in value or it reads as a white band
    const lipCol = dbgParts ? lin(0xff00c0) : lin(P.lip);

    const d = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const po = new THREE.Vector3();
    const pi = new THREE.Vector3();

    let v = 0;
    for (let i = 0; i < NPHI; i++) {
        const phi = i / NPHI * TAU;
        const tc = cutAt(phi);

        for (let r = 0; r <= NROW; r++) {
            let theta, radius, shell, k = 0;

            if (r <= NA) {
                const s = r / NA;
                theta = tc + (Math.PI - tc) * s;
                shell = 0;
            } else if (r <= NA + NB) {
                const s = (r - NA) / NB;
                theta = Math.PI - (Math.PI - tc) * s;
                shell = 1;
            } else {
                k = (r - NA - NB) / NC;
                theta = tc;
                shell = 2;
            }

            dirAt(phi, theta, d);
            const rel = relief(d);
            const ro = R * rel;
            const ri = (R - WALL) * (1 + (rel - 1) * 0.75);

            let x, y, z;
            if (shell === 0) {
                radius = ri;
                x = d.x * radius; y = d.y * radius; z = d.z * radius;
            } else if (shell === 1) {
                radius = ro;
                x = d.x * radius; y = d.y * radius; z = d.z * radius;
            } else {
                // lip: an arc from the outer edge round to the inner edge,
                // bulging toward the opening so the cut catches a highlight
                po.copy(d).multiplyScalar(ro);
                pi.copy(d).multiplyScalar(ri);
                const st = Math.sin(theta), ct = Math.cos(theta);
                const cp = Math.cos(phi), sp = Math.sin(phi);
                tan.set(
                    AXIS.x * st - (EU.x * cp + EV.x * sp) * ct,
                    AXIS.y * st - (EU.y * cp + EV.y * sp) * ct,
                    AXIS.z * st - (EU.z * cp + EV.z * sp) * ct
                ).normalize();
                const bulge = Math.sin(Math.PI * k) * WALL * 0.60;
                x = mix(po.x, pi.x, k) + tan.x * bulge;
                y = mix(po.y, pi.y, k) + tan.y * bulge;
                z = mix(po.z, pi.z, k) + tan.z * bulge;
            }

            const o = v * 3;
            pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;

            // albedo: mottled everywhere, and driven down deep in the cavity so
            // the interior has falloff even before any occlusion pass
            const mott = dbgParts ? 1
                : 1 + num('mott', 0.075) * fbm(d.x * 4.3 + 21, d.y * 4.3 + 13, d.z * 4.3 - 8, 3);
            let c;
            if (dbgParts) {
                c = shell === 0 ? innerCol : shell === 2 ? lipCol : outerCol;
                col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
            } else if (shell === 0) {
                const a = (d.dot(AXIS) + 1) / 2;
                let depth = mix(0.34, 0.92, Math.pow(smoothstep(0, 1, a), 0.85));
                // the corner where the wall turns into the lip is a crease and
                // holds a shadow, which is what stops the rim reading as a
                // bright line drawn around the hole
                depth *= mix(0.52, 1.0, smoothstep(0, 0.075, r / NA));
                c = innerCol;
                col[o] = c.r * mott * depth;
                col[o + 1] = c.g * mott * depth;
                col[o + 2] = c.b * mott * depth;
            } else {
                c = shell === 2 ? lipCol : outerCol;
                col[o] = c.r * mott;
                col[o + 1] = c.g * mott;
                col[o + 2] = c.b * mott;
            }

            uv[v * 2] = i / NPHI;
            uv[v * 2 + 1] = r / NROW;
            v++;
        }
    }

    /* Row-major, so the inner wall occupies one contiguous run of indices and
       can be given its own material: a cavity lit by the same environment as
       the outside washes out, having no idea it is a cavity. */
    const idx = [];
    const stride = NROW + 1;
    for (let r = 0; r < NROW; r++) {
        for (let i = 0; i < NPHI; i++) {
            const i1 = (i + 1) % NPHI;
            const a = i * stride + r;
            const b = i1 * stride + r;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    const innerCount = NA * NPHI * 6;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.addGroup(0, innerCount, 0);
    geo.addGroup(innerCount, idx.length - innerCount, 1);
    geo.computeVertexNormals();

    // the outer wall must face out; the strip is built in one order, so
    // checking one segment decides the winding for the whole shell
    let s = 0;
    const nor = geo.attributes.normal;
    for (let i = 0; i < NPHI; i += 7) {
        const j = i * stride + NA + Math.round(NB * 0.5);
        s += pos[j * 3] * nor.getX(j) + pos[j * 3 + 1] * nor.getY(j) + pos[j * 3 + 2] * nor.getZ(j);
    }
    if (s < 0) {
        const a = geo.index.array;
        for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
        geo.index.needsUpdate = true;
        geo.computeVertexNormals();
    }

    return geo;
}

const membraneMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: num('mrough', 0.58),
    metalness: 0,
    clearcoat: num('mcoat', 0.12),
    clearcoatRoughness: 0.55,
    sheen: num('msheen', 0.12),
    sheenRoughness: 0.9,
    sheenColor: lin(0xffe6a0),
    envMapIntensity: num('menv', 0.70),
    side: THREE.DoubleSide
});

// the cavity sees almost none of the room, so it is given far less of it
const cavityMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: num('crough', 0.80),
    metalness: 0,
    clearcoat: 0,
    sheen: 0,
    envMapIntensity: num('cenv', 0.26),
    side: THREE.DoubleSide
});

const membrane = new THREE.Mesh(buildMembrane(), [cavityMat, membraneMat]);
membrane.castShadow = true;
membrane.receiveShadow = true;
scene.add(membrane);

/* ---------- receptors ---------- */

/* A knob is a ball with shallow meridian creases and a dimple at the top: a
   receptor cluster at this scale is a rounded body, and the creases are what
   keep a field of them from reading as a field of dots. */
function knobGeometry() {
    const g = new THREE.SphereGeometry(1, 30, 22);
    const p = g.attributes.position;
    const vec = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        vec.fromBufferAttribute(p, i);
        const theta = Math.acos(clamp(vec.y, -1, 1));
        const phi = Math.atan2(vec.z, vec.x);
        let rad = 1 - 0.055 * Math.pow(Math.abs(Math.cos(3 * phi)), 2.2) * Math.pow(Math.sin(theta), 0.8);
        rad -= 0.13 * Math.exp(-Math.pow(theta / 0.38, 2));
        vec.multiplyScalar(rad);
        vec.y *= 0.88;
        p.setXYZ(i, vec.x, vec.y, vec.z);
    }
    g.computeVertexNormals();
    return g;
}

function buildReceptors() {
    const geo = knobGeometry();
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        vertexColors: false,
        roughness: 0.46,
        metalness: 0,
        clearcoat: 0.28,
        clearcoatRoughness: 0.42,
        envMapIntensity: 0.9
    });

    const N = Math.round(num('knobs', 200));
    const picks = [];
    const d = new THREE.Vector3();
    const golden = Math.PI * (1 + Math.sqrt(5));

    for (let i = 0; i < N; i++) {
        const y = 1 - (i + 0.5) / N * 2;
        const rr = Math.sqrt(Math.max(0, 1 - y * y));
        const th = golden * i;
        d.set(Math.cos(th) * rr, y, Math.sin(th) * rr);
        d.x += (rnd() - 0.5) * 0.055;
        d.y += (rnd() - 0.5) * 0.055;
        d.z += (rnd() - 0.5) * 0.055;
        d.normalize();

        const ang = Math.acos(clamp(d.dot(AXIS), -1, 1));
        const phi = Math.atan2(d.dot(EV), d.dot(EU));
        if (ang < cutAt(phi) + 0.05) continue;
        picks.push(d.clone());
    }

    if (!picks.length) return new THREE.Group();

    const mesh = new THREE.InstancedMesh(geo, mat, picks.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const base = lin(P.knob);
    const c = new THREE.Color();

    for (let i = 0; i < picks.length; i++) {
        const dir = picks[i];
        const rel = relief(dir);
        const s = num('knobsize', 0.058) * (0.76 + rnd() * 0.52);
        // seated a little into the wall, so the base of each is swallowed by
        // the membrane rather than meeting it on a hard circle
        pos.copy(dir).multiplyScalar(R * rel + s * 0.30);
        q.setFromUnitVectors(up, dir);
        sc.set(s, s * (0.86 + rnd() * 0.36), s);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(i, m);

        const t = 0.82 + rnd() * 0.36;
        c.setRGB(base.r * t, base.g * t, base.b * (t * 0.98 + 0.02));
        mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
}

scene.add(buildReceptors());

/* Transmembrane proteins caught in cross-section at the cut, which is what
   makes the wall read as a wall rather than as a shell of paint. */
function buildPores() {
    const geo = new THREE.CapsuleGeometry(1, 1.6, 6, 16);
    const mat = new THREE.MeshPhysicalMaterial({
        color: lin(P.pore), roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.3
    });
    const N = Math.round(num('pores', 9));
    if (!N) return new THREE.Group();

    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const d = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();

    for (let i = 0; i < N; i++) {
        const phi = (i / N) * TAU + 0.35;
        const theta = cutAt(phi) + 0.035 + rnd() * 0.05;
        dirAt(phi, theta, d);
        const rel = relief(d);
        pos.copy(d).multiplyScalar((R - WALL * 0.5) * rel);
        q.setFromUnitVectors(up, d);
        const s = 0.030 * (0.85 + rnd() * 0.4);
        sc.set(s, s * 0.9, s);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
}

scene.add(buildPores());

/* ---------- nucleus ---------- */

const NUC = new THREE.Vector3(num('nx', 0.01), num('ny', 0.00), num('nz', 0.05));
const NUC_R = num('nr', 0.21);

function buildNucleus() {
    // a polyhedron comes back non-indexed, which flat-shades every face once
    // its normals are recomputed; welding it first is what keeps it a blob
    const g = mergeVertices(new THREE.IcosahedronGeometry(NUC_R, 6));
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = v.clone().normalize();
        const k = 1
            + 0.050 * fbm(n.x * 2.2 + 31, n.y * 2.2 - 17, n.z * 2.2 + 5, 3)
            + 0.012 * fbm(n.x * 5.0 - 2, n.y * 5.0 + 9, n.z * 5.0 + 3, 2);
        v.multiplyScalar(k);
        p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();

    const mat = new THREE.MeshPhysicalMaterial({
        color: lin(P.nuc),
        roughness: 0.58,
        clearcoat: 0.35,
        clearcoatRoughness: 0.45,
        sheen: 0.4,
        sheenColor: lin(0xffc8c0),
        envMapIntensity: num('nenv', 0.5)
    });

    const mesh = new THREE.Mesh(g, mat);
    mesh.position.copy(NUC);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

scene.add(buildNucleus());

/* ---------- cytoskeleton ---------- */

/* Two families: an aster of long filaments radiating off a point beside the
   nucleus, and a shorter tangled cortical mesh out near the wall. Both are
   tubes along wandering curves, merged into one geometry. */
function tubeFrom(points, radius, colFn, tubular, radial) {
    const curve = new THREE.CatmullRomCurve3(points);
    const g = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const c = colFn(v);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
}

/* Nothing should reach the height of the rim: filaments that do cross the lip
   in silhouette and turn the opening into a thicket. Under the cut they are
   held down to a lower ceiling that tapers toward the middle of the hole. */
function confine(p) {
    const len = p.length();
    if (len < 1e-5) return p;
    const ang = Math.acos(clamp(p.dot(AXIS) / len, -1, 1));
    const phi = Math.atan2(p.dot(EV), p.dot(EU));
    const lim = cutAt(phi) + 0.14;
    const ceiling = ang < lim ? mix(0.60, 0.88, clamp(ang / lim, 0, 1)) : 0.88;
    if (len > ceiling) p.multiplyScalar(ceiling / len);
    return p;
}

function buildCytoskeleton() {
    const parts = [];
    // the aster radiates from the nucleus itself and starts clear of its
    // surface, so the nucleus stays visible instead of being buried in tubes
    const centre = NUC.clone().add(new THREE.Vector3(0.01, 0.04, -0.06));

    const pale = lin(P.filPale);
    const cyan = lin(P.filMid);
    const deep = lin(P.filDeep);
    const fr = num('filr', 1);

    /* Filaments are too fine to pick up much shading of their own, so depth
       has to come from the albedo: the ones further from the camera are
       carried down toward the colour of the cavity behind them. */
    const depthFade = v => mix(0.42, 1.06, smoothstep(-0.85, 0.75, v.z));

    const asterColour = v => {
        const t = smoothstep(0.10, 0.62, v.distanceTo(centre));
        const k = depthFade(v);
        return new THREE.Color(
            mix(pale.r, cyan.r, t) * k, mix(pale.g, cyan.g, t) * k, mix(pale.b, cyan.b, t) * k);
    };
    const meshColour = v => {
        const t = smoothstep(0.55, 0.95, v.length());
        const k = depthFade(v);
        return new THREE.Color(
            mix(cyan.r, deep.r, t) * k, mix(cyan.g, deep.g, t) * k, mix(cyan.b, deep.b, t) * k);
    };

    // aster
    const NA = Math.round(num('aster', 330));
    for (let i = 0; i < NA; i++) {
        const y = 1 - (i + 0.5) / NA * 2;
        const rr = Math.sqrt(Math.max(0, 1 - y * y));
        const th = Math.PI * (1 + Math.sqrt(5)) * i;
        const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
        dir.x += (rnd() - 0.5) * 0.5; dir.y += (rnd() - 0.5) * 0.5; dir.z += (rnd() - 0.5) * 0.5;
        dir.normalize();

        // filaments coming straight at the camera cross in front of the
        // nucleus and hide it, so that cone is thinned rather than filled
        if (dir.z > 0.35 && rnd() < 0.8) continue;

        const end = mix(0.62, 0.90, rnd());
        const steps = 8;
        const pts = [];
        const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0.13, 0.91, 0.4)).normalize();
        const side2 = new THREE.Vector3().crossVectors(dir, side).normalize();
        const wob = 0.03 + rnd() * 0.07;
        const ph = rnd() * TAU;
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const rad = mix(NUC_R * 1.08, end, t);
            const p = dir.clone().multiplyScalar(rad);
            const bend = Math.sin(t * 2.1 + ph) * wob * t;
            p.addScaledVector(side, bend);
            p.addScaledVector(side2, Math.sin(t * 3.3 - ph) * wob * 0.7 * t);
            p.add(centre);
            pts.push(confine(p));
        }
        parts.push(tubeFrom(pts, (0.0020 + rnd() * 0.0022) * fr, asterColour, 14, 5));
    }

    // cortical tangle
    const NM = Math.round(num('mesh', 300));
    for (let i = 0; i < NM; i++) {
        const dir = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
        const start = confine(dir.clone().multiplyScalar(mix(0.48, 0.86, rnd())));
        // started tangential to the wall and turned gently, so each one reads
        // as a filament following the cortex rather than as a stray scribble
        let head = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)).normalize();
        const pts = [start.clone()];
        const p = start.clone();
        const steps = 9;
        const len = mix(0.30, 0.80, rnd());
        for (let s = 0; s < steps; s++) {
            head.x += (rnd() - 0.5) * 0.42;
            head.y += (rnd() - 0.5) * 0.42;
            head.z += (rnd() - 0.5) * 0.42;
            head.normalize();
            p.addScaledVector(head, len / steps);
            // keep the tangle inside the shell and out of the nucleus
            confine(p);
            const dn = p.distanceTo(NUC);
            if (dn < NUC_R * 1.12) {
                p.sub(NUC).multiplyScalar(NUC_R * 1.12 / Math.max(dn, 1e-4)).add(NUC);
            }
            pts.push(p.clone());
        }
        parts.push(tubeFrom(pts, (0.0016 + rnd() * 0.0030) * fr, meshColour, 12, 5));
    }

    if (!parts.length) return new THREE.Group();

    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();

    const mat = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.42,
        metalness: 0,
        clearcoat: 0.3,
        clearcoatRoughness: 0.4,
        envMapIntensity: num('fenv', 0.6)
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

scene.add(buildCytoskeleton());

/* ---------- composition ---------- */

const composer = new EffectComposer(renderer);
composer.setPixelRatio(DPR);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));

if (on('ao', true)) {
    const ao = new GTAOPass(scene, camera, W * DPR, H * DPR);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.updateGtaoMaterial({
        radius: num('aorad', 0.85),
        distanceExponent: 1.4,
        thickness: 0.8,
        scale: num('aoscale', 1.5),
        samples: 24,
        screenSpaceRadius: false
    });
    ao.blendIntensity = num('aoint', 1.0);
    composer.addPass(ao);
}

if (on('dof', true)) {
    composer.addPass(new BokehPass(scene, camera, {
        focus: camera.position.length() - num('focus', 0.55),
        aperture: num('aperture', 0.0011),
        maxblur: num('maxblur', 0.006)
    }));
}

composer.addPass(new OutputPass());

composer.render();

const hud = document.getElementById('hud');
if (on('dbg', false)) {
    hud.style.display = 'block';
    hud.textContent = `${W}x${H} dpr${DPR} q${Q} · ${Math.round(performance.now() - t0)}ms`;
}
document.title = 'done ' + Math.round(performance.now() - t0);
