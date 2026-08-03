import * as THREE from 'three';

/* Shared between the hero still (scene.js) and the sprite baker (atlas.js):
   the noise the surface relief is built from, colour handling, and the studio
   the whole look depends on. */

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

export function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function makePerlin(seed) {
    const rnd = mulberry32(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = (rnd() * (i + 1)) | 0;
        const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    const p = new Uint16Array(512);
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + (b - a) * t;
    function grad(h, x, y, z) {
        h &= 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
        return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    }

    return function (x, y, z) {
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
        x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
        const u = fade(x), v = fade(y), w = fade(z);
        const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
        const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
        return lerp(
            lerp(lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
                lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
            lerp(lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
                lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
            w);
    };
}

export function makeFbm(noise) {
    return function (x, y, z, octaves) {
        let sum = 0, amp = 1, norm = 0, f = 1;
        for (let i = 0; i < octaves; i++) {
            sum += noise(x * f, y * f, z * f) * amp;
            norm += amp;
            amp *= 0.5; f *= 2.03;
        }
        return sum / norm;
    };
}

/* Colours are authored as sRGB hex and used as linear working-space values,
   which is what a vertex colour attribute is taken to be. */
export function lin(hex) {
    const c = new THREE.Color();
    c.setHex(hex, THREE.SRGBColorSpace);
    return c;
}

/* The colour that comes back out of ACES as the one asked for. Used for the
   background, which is tone mapped along with everything else and would
   otherwise be dragged toward grey. */
export function untonemap(target, exposure) {
    const IN = [0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777];
    const OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];
    const mul = (m, v) => [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
    const fit = v => v.map(x => {
        const a = x * (x + 0.0245786) - 0.000090537;
        const b = x * (0.983729 * x + 0.4329510) + 0.238081;
        return a / b;
    });
    const aces = v => mul(OUT, fit(mul(IN, v.map(x => x * exposure / 0.6))))
        .map(x => clamp(x, 0, 1));

    const t = [target.r, target.g, target.b];
    const x = t.slice();
    for (let i = 0; i < 60; i++) {
        const y = aces(x);
        for (let c = 0; c < 3; c++) x[c] *= t[c] / Math.max(y[c], 1e-4);
    }
    return new THREE.Color(x[0], x[1], x[2]);
}

/* A studio as a float equirect rather than a canvas gradient: the key has to
   be brighter than white to read as a light source in the specular instead of
   as a pale patch of sky.

   Directions must be laid out the way three samples an equirect, which is
   u = atan2(z,x)/2pi + 0.5 and v = asin(y)/pi + 0.5 against a data texture
   that is not flipped. Get this wrong and the room is mirrored and upside
   down, and its key fights the directional key instead of reinforcing it. */
export function buildEnvironment(renderer, opts) {
    const w = 512, h = 256;
    const data = new Float32Array(w * h * 4);

    const room = opts.room, ceiling = opts.ceiling, floor = opts.floor, keyTint = opts.key;
    const key = new THREE.Vector3(-0.52, 0.72, 0.46).normalize();
    const fill = new THREE.Vector3(0.78, 0.16, 0.30).normalize();
    const back = new THREE.Vector3(0.15, 0.30, -0.94).normalize();
    const d = new THREE.Vector3();

    for (let y = 0; y < h; y++) {
        const v = (y + 0.5) / h;
        const dy = Math.sin((v - 0.5) * Math.PI);
        const ring = Math.sqrt(Math.max(0, 1 - dy * dy));
        for (let x = 0; x < w; x++) {
            const a = ((x + 0.5) / w - 0.5) * TAU;
            d.set(ring * Math.cos(a), dy, ring * Math.sin(a));

            /* Kept dim away from the sources: an even dome washes a sphere
               flat, and the whole read of the form comes from one soft key
               falling off into a much darker surround. */
            const up = d.y;
            let r, g, b;
            if (up > 0) {
                r = mix(room[0], ceiling[0], up);
                g = mix(room[1], ceiling[1], up);
                b = mix(room[2], ceiling[2], up);
            } else {
                const t = -up;
                r = mix(room[0], floor[0], t);
                g = mix(room[1], floor[1], t);
                b = mix(room[2], floor[2], t);
            }

            const k = smoothstep(0.80, 0.995, d.dot(key));
            const kk = k * k * 22.0 + smoothstep(0.35, 0.90, d.dot(key)) * 2.2;
            r += kk * keyTint[0]; g += kk * keyTint[1]; b += kk * keyTint[2];

            const f = smoothstep(0.55, 0.98, d.dot(fill)) * 0.95;
            r += f * 0.62; g += f * 0.70; b += f * 0.86;

            const bk = smoothstep(0.70, 0.99, d.dot(back)) * 0.70;
            r += bk * 0.92; g += bk * 0.90; b += bk * 0.86;

            const i = (y * w + x) * 4;
            data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
        }
    }

    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.needsUpdate = true;

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    tex.dispose();
    return env;
}
