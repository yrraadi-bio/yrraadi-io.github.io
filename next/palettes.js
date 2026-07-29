/* The colours the whole sequence is told in.
 *
 * Read by mitosis.js as a plain script and by _cell/atlas.js as a module
 * import, because the sprite atlas is baked one row per palette and the row a
 * cell is cut from is its palette's id. If the two ever disagree about how many
 * palettes there are, or what order they are in, every cell after the first
 * comes out the wrong colour, so there is exactly one copy of the table.
 *
 * The story the colours have to carry:
 *   - healthy tissue is blue,
 *   - the first mutation takes one colour and holds it,
 *   - its subclones are shades of that same colour, because they descend from
 *     it and are variations on its error rather than new diseases,
 *   - a second, independent mutation takes an unrelated colour, because it did
 *     not come from the first one.
 */
(function (root) {
    'use strict';

    function toHsl(rgb) {
        const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / d + 2) / 6;
            else h = ((r - g) / d + 4) / 6;
        }
        return [h, s, l];
    }

    function toRgb(hsl) {
        const h = ((hsl[0] % 1) + 1) % 1;
        const s = Math.min(1, Math.max(0, hsl[1]));
        const l = Math.min(1, Math.max(0, hsl[2]));
        if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const hue = t => {
            t = ((t % 1) + 1) % 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        return [
            Math.round(hue(h + 1 / 3) * 255),
            Math.round(hue(h) * 255),
            Math.round(hue(h - 1 / 3) * 255)
        ];
    }

    const ROLES = ['core', 'mid', 'edge', 'nuc', 'deep'];

    /* A subclone is the parent palette moved a little way around the wheel and
       up or down in tone. Every role moves together, so the shade stays
       recognisably the same colour rather than becoming a new one. */
    function shade(base, id, shift) {
        const out = { id: id };
        for (const role of ROLES) {
            const hsl = toHsl(base[role]);
            out[role] = toRgb([hsl[0] + shift.h, hsl[1] + shift.s, hsl[2] + shift.l]);
        }
        return out;
    }

    const HEALTHY = {
        id: 0,
        core: [150, 198, 248],
        mid: [78, 132, 205],
        edge: [176, 214, 255],
        nuc: [128, 184, 248],
        deep: [22, 50, 106]
    };

    // the first mutation, and the colour the tumor is read by from here on
    const PRIMARY = {
        id: 1,
        core: [236, 146, 178],
        mid: [172, 74, 116],
        edge: [246, 178, 202],
        nuc: [214, 110, 152],
        deep: [78, 20, 48]
    };

    const SUBCLONES = [
        shade(PRIMARY, 2, { h: 0.050, s: -0.02, l: 0.045 }),
        shade(PRIMARY, 3, { h: -0.046, s: 0.00, l: -0.035 }),
        // kept off the bottom of the range on purpose: a shade this desaturated
        // reads as a shadowed cell rather than a different clone if it also goes
        // dark, and cells are already dimmed by where they sit in the mass
        shade(PRIMARY, 4, { h: 0.020, s: -0.13, l: -0.020 })
    ];

    /* A separate cell that went wrong on its own. Unrelated to the first, so
       unrelated in colour: warm against the magenta family, and nowhere near
       the blue that healthy tissue is drawn in. */
    const SECOND = {
        id: 5,
        core: [240, 178, 120],
        mid: [180, 104, 40],
        edge: [248, 200, 152],
        nuc: [220, 146, 72],
        deep: [72, 38, 8]
    };

    const ALL = [HEALTHY, PRIMARY].concat(SUBCLONES, [SECOND]);

    root.CELL_PALETTES = {
        all: ALL,
        healthy: HEALTHY,
        primary: PRIMARY,
        subclones: SUBCLONES,
        second: SECOND,
        // every palette that is not healthy tissue, for the other patients
        malignant: [PRIMARY].concat(SUBCLONES, [SECOND])
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
