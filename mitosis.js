/*
 * A tumor turns out to be one of millions. Three phases on one canvas.
 *
 * Trials (0 -> BIO_A), scrolled. Two charts state the problem the rest of it
 * explains, at the reader's pace because they are read rather than watched.
 *
 * The figure (BIO_A -> META_END), still. One labelled picture of a finished
 * tumor, held while its caption is up. Cells are placed along a binary lineage
 * tree, relaxed so they pack instead of stack, and the generation count is per
 * lineage: healthy tissue divides a handful of times and a mutated lineage keeps
 * going, which is what makes the mass a patchwork rather than a ball of one
 * colour. One clone carries subclones as shades of the colour it already has, a
 * second clone on the far side arose on its own, and cells that left along the
 * vessels have settled away from it. The labels name all four, since colour alone
 * cannot tell them apart and telling them apart is the point.
 *
 * Cohort (META_END -> 1), scrolled. The camera pulls back off that tumor, which
 * resolves into a stained section, and takes its place in a grid of other
 * patients' sections. Same diagnosis, different disease.
 */
(function () {
    const canvas = document.getElementById('mitosis');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let dctx = ctx;

    const stage = document.getElementById('stage');
    const railFill = document.getElementById('railFill');
    const storyBeat = document.getElementById('storyBeat');
    // scoped, because the engine stage below reuses the same caption markup
    const captions = Array.from(document.querySelectorAll('#captions .caption'));

    const TAU = Math.PI * 2;
    const MAX_GEN = 9;
    const BASE_R = 0.19;
    const SHRINK = 0.80;
    // the generation whose ancestors are the lineages mutations are tracked by
    const CLONE_GEN = 3;
    // and the one the founding clone's subclones separate at. Deep enough that
    // the clone is carved into eight territories rather than a couple, which is
    // the difference between a patchwork and two halves
    const SUB_GEN = 6;

    /* Where the acts end, in scroll position.

       The two charts open the stage: plenty of drugs being tried and very few of
       them getting through is the problem, and the biology is the explanation, so
       the problem is stated first. BIO_A is where they hand it over.

       BIO_A to META_END is one still figure, where it was once nine beats of
       animation over six and a half screens. Nothing in it moves and nothing in
       it is driven by anything: a finished tumor, labelled, held for as long as
       its caption is up. What the reader scrolls is what scrolling is for, the
       charts either side of it, which are read rather than watched. */
    const BIO_A = 0.501;
    const META_END = 0.637;

    // where the grid has finished filling and starts picking its shortlist out
    const COHORT_FULL = 0.815;

    const PALETTES = globalThis.CELL_PALETTES;
    const HEALTHY = PALETTES.healthy;
    const CLONES = PALETTES.malignant;

    /* The two grounds a canvas can be drawn against. Both stages sit on paper as
       the page currently reads; the blue entry is what the prose blocks between
       them run on, and is kept because which section takes which ground is a
       thing that moves.

       Most of the drawing does not care, because a cell is a baked render with
       its own light in it. Three things do, and all for the same reason: they
       work by moving a colour toward the background, so they have to know which
       background that is. Occlusion recedes a buried cell into the ground, a
       glow falls off to it, and ink has to oppose it. Get the direction wrong
       and depth inverts — a buried cell painted darker than white paper comes
       forward instead of dropping back. */
    const GROUNDS = {
        paper: {
            occlude: [238, 241, 246],
            // an aura falls off to the ground it sits on, and a canvas gradient
            // interpolates the colour as well as the alpha, so the wrong end
            // leaves a ring of it tinting the whole falloff
            fade: 'rgba(247,248,251,0)',
            ink: '22,38,62',
            inkAccent: '19,72,150',
            // a ring on paper is drawn, not lit: no bloom, and enough weight to
            // hold its own against ink rather than against darkness
            ring: '19,72,150',
            ringAlpha: 0.5,
            halo: 0,
            vessel: 2.1
        },
        dark: {
            occlude: [5, 12, 26],
            fade: 'rgba(6,14,28,0)',
            ink: '198,216,240',
            inkAccent: '150,196,255',
            ring: '158,203,255',
            ringAlpha: 0.62,
            halo: 1,
            vessel: 1
        }
    };
    let ground = GROUNDS.paper;

    let W = 0, H = 0, minDim = 0, cx = 0, cy = 0, wide = true;
    // the band the figure sits in, and the half-extent it is drawn at
    let figTop = 0, figBand = 0, figR = 0;
    const figCy = () => figTop + figBand / 2;
    let dpr = 1;
    /* The width the stylesheet stops widening the page at, matched to --page, and
       the band the stage composes inside once it has.

       Every horizontal place on this canvas is a fraction of the viewport, which
       is right up to the point the copy over it stops being one: --gut holds the
       caption column to a measure past 1454px, and the artwork carrying on out to
       the edges met it coming the other way — on an ultrawide screen the cohort
       grid was printed straight through the copy beside it. So past that width the
       extra goes to the margins and the fractions are taken against the band,
       which is the same thing as the viewport at every width below it. */
    const PAGE = 1250;
    const FRAME = Math.round(PAGE / 0.86);
    let fx = 0, fw = 0;
    // the band the trials charts get on a narrow screen, worked out on resize
    let chartTop = 0, chartFloor = 0;
    // device pixels per canvas unit, so a cell is baked at the resolution it is
    // actually about to be shown at
    let pxScale = 1;
    let targetP = 0, p = 0;
    let cohort = null;
    // all seeded off the canvas size, so all are dropped on a resize
    let spread = null;
    let grown = null;

    const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
    const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = t => t * t * (3 - 2 * t);

    function hash(n) {
        const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return s - Math.floor(s);
    }

    function rng(seed) {
        let s = (seed * 2654435761) >>> 0;
        return function () {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    function chan(a, b, m, i) {
        return Math.round(a[i] + (b[i] - a[i]) * m);
    }

    /* ---------- what goes wrong, and when ---------- */

    /* Both mutations, in growth-phase progress. The first is the one the story
       follows. The second lands much later in a lineage that was still healthy,
       so the tumor ends up with two origins rather than one. */
    const MUT = 0.44;
    const POLY = 0.72;
    const MUT_RAMP = 0.09;

    /* Which of the eight lineages present at CLONE_GEN went wrong. A lineage is
       identified by its ancestor at that generation, which does not change as
       the tree deepens, so a lineage keeps both its identity and the patch of
       the mass it holds. Index 1 and index 6 sit in opposite halves of the
       tree, and therefore opposite sides of the mass, which is what makes the
       second origin read as separate rather than as more of the first. */
    const LINEAGES = [
        null,
        { pal: PALETTES.primary, onset: MUT, subclones: true },
        null, null, null, null,
        { pal: PALETTES.second, onset: POLY, subclones: false },
        null
    ];

    /* Subclones of the founding clone, in the order they separate. Each is a
       shade of the colour that clone already carries, so what the visitor sees
       late on is one colour coming apart rather than new colours arriving. */
    const SUBS = PALETTES.subclones.map((pal, i) => ({ pal, onset: 0.82 + i * 0.045 }));

    function lineageOf(path, depth) {
        return depth >= CLONE_GEN ? LINEAGES[path >> (depth - CLONE_GEN)] : null;
    }

    /* Which subclone a cell of the founding clone belongs to, decided by its
       ancestor at SUB_GEN so that a subclone holds contiguous ground instead of
       speckling through the clone. Some of the clone never diverges at all. */
    function subcloneOf(path, depth) {
        if (depth <= SUB_GEN) return null;
        const k = hash((path >> (depth - SUB_GEN)) * 41.7 + 3.1);
        if (k < 0.40) return null;
        return SUBS[Math.min(SUBS.length - 1, Math.floor((k - 0.40) / 0.20))];
    }

    /* Generations against scroll, for tissue still under control. Deliberately
       shallow: there is a long stretch of the page where a visitor scrolls and
       almost nothing divides, which is what makes the mutation land as a change
       of pace instead of more of the same. */
    const GEN_HEALTHY = [[0, 0], [0.085, 1], [0.26, 2], [0.52, 3], [0.72, 3.6], [1, 3.95]];

    /* Extra generations a mutated lineage gets over a healthy one. The tree is
       only ever built at mp = 1 now, so this sets how far ahead the clones end up
       and nothing about any growth: it is the difference between a mass that is
       plainly a patchwork and one whose clones are the same grain as the tissue
       around them. */
    const MUT_RATE = 9.6;

    /* How much of a cell's size follows its own lineage's depth rather than the
       mass average. Taking it straight off its own depth is truthful to the
       tree and looks absurd, because a lineage five generations ahead ends up
       with cells a quarter the width of its neighbours. Pulled most of the way
       back toward the average, tumor cells stay visibly finer-grained than the
       tissue they are displacing without the mass turning into gravel. */
    const DEPTH_MIX = 0.5;

    function curveAt(pts, x) {
        if (x <= pts[0][0]) return pts[0][1];
        for (let i = 1; i < pts.length; i++) {
            if (x > pts[i][0]) continue;
            const a = pts[i - 1], b = pts[i];
            return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
        }
        return pts[pts.length - 1][1];
    }

    function budgetFor(onset, mp) {
        const base = curveAt(GEN_HEALTHY, mp);
        if (onset === null || mp <= onset) return base;
        return Math.min(MAX_GEN, base + (mp - onset) * MUT_RATE);
    }

    /* Where each stage sits in the document, and how far it travels.

       Held here rather than read per frame. Both stages used to be measured
       with getBoundingClientRect() on every frame, which forces the browser to
       flush layout twice before either canvas can draw; the same numbers can be
       taken once and turned into a viewport-relative position with the one
       scroll offset the frame already reads. They only move when the document
       is laid out again, which is a resize or a late webfont. */
    let sTop = 0, sTravel = 1, eTop = 0, eTravel = 1;

    function measureStages() {
        sTop = stage.getBoundingClientRect().top + window.scrollY;
        sTravel = Math.max(stage.offsetHeight - window.innerHeight, 1);
        if (!estage) return;
        eTop = estage.getBoundingClientRect().top + window.scrollY;
        eTravel = Math.max(estage.offsetHeight - window.innerHeight, 1);
    }

    /* The cheap half of a resize: the canvas backing stores and the frame
       geometry, with every cached layout left alone. */
    function measure() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = canvas.clientWidth;
        H = canvas.clientHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // the second stage shares this canvas's geometry, so that a slot in the
        // cohort grid lands in the same place on both
        if (ecanvas) {
            ecanvas.width = canvas.width;
            ecanvas.height = canvas.height;
            ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        minDim = Math.min(W, H);
        wide = W > 860;
        fx = Math.max(0, (W - FRAME) / 2);
        fw = W - fx * 2;
        // the frame is offset to clear the caption column beside it
        cx = fx + fw * (wide ? 0.58 : 0.5);
        cy = H * (wide ? 0.5 : 0.42);
        measureTrials();
        measureFigure();
        measureChrome();
        measureStages();
    }

    /* Where the page's own furniture sits on top of the canvas, so a name on the
       figure can be kept off it. Read off the elements rather than guessed at as
       bands: the count, the rail and the way out are one strip along the floor,
       in the corner on a desktop and across the full width on a phone. Taken on
       resize, because reading layout per frame is what a canvas is for avoiding. */
    const chromeBoxes = [];

    function measureChrome() {
        chromeBoxes.length = 0;
        const box = canvas.getBoundingClientRect();
        for (const el of stage.querySelectorAll('.progress, .onward')) {
            const r = el.getBoundingClientRect();
            if (!r.width) continue;
            const pad = 8;
            chromeBoxes.push({ x: r.left - box.left - pad, y: r.top - box.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 });
        }
    }

    /* The band the figure has to itself, and where its middle is.

       Beside the prose on a wide screen that is the whole box. On a narrow one the
       prose is underneath the figure rather than alongside it, and the strip
       carrying the count and the way out is across the top, so the figure gets
       what is left between them. It used to take the middle of the box regardless
       and overhang both: on a small phone the copy starts at three fifths of the
       canvas against three quarters on a tablet, and the bottom of the mass was
       printed through the heading.

       The mass is fitted to the band as well as centred in it, because on the
       tightest layout the band is shorter than the mass wants to be and centring
       alone would overhang it equally at both ends. */
    function measureFigure() {
        figTop = 0;
        figBand = H;
        figR = minDim * 0.418;

        if (wide) return;

        // the caption is anchored near the bottom of the box, so its top is what
        // its own height leaves
        let copy = 0;
        for (const el of captions) {
            if (el.hasAttribute('data-from')) copy = Math.max(copy, el.offsetHeight);
        }

        const short = H <= 560;
        figTop = H * (short ? 0.04 : 0.08) + 32;
        figBand = Math.max(H * 0.30, H * 0.88 - copy - 10 - figTop);
        figR = Math.min(figR, figBand / 2);
    }

    /* Where the two charts start and stop on a narrow screen, where they share the
       box with the caption instead of sitting beside it.

       Both ends were fractions of the height, which held on the phone they were
       set against and nowhere else: the caption is display type with a floor under
       it, so on a 320px screen it grows to a third of the box and the charts were
       printed through the heading, and on a landscape phone the count and the way
       out across the top were printed through the plot.

       So both ends are measured instead. The floor comes off the taller of the two
       captions that actually carry a chart — the only two the wash is up for —
       which are the ones with a flat plot in them for the still branch. Read here
       rather than per frame, and read again when the webfont lands and changes
       what a heading measures. */
    function measureTrials() {
        chartTop = H * 0.04;
        chartFloor = H * 0.72;
        if (wide) return;

        let tall = 0;
        for (const el of captions) {
            if (el.querySelector('.caption__plot')) tall = Math.max(tall, el.offsetHeight);
        }

        // under the strip the count and the way out share, and above the caption,
        // whose own offset from the bottom comes up on a short box
        const short = H <= 560;
        chartTop = H * (short ? 0.04 : 0.08) + 32;
        chartFloor = Math.min(H * 0.76, H * (short ? 0.93 : 0.88) - tall - 14);
    }

    /* The expensive half: everything seeded off the canvas size, which has to
       be built again from scratch. */
    function resize() {
        measure();
        verdict = null;
        cohort = null;
        spread = null;
        grown = null;
        query = null;
    }

    /* A phone collapsing its address bar fires a resize with the width
       unchanged, and the full teardown above on that event means the first
       scroll of a page visit throws away and rebuilds the entire scene. A
       height-only change small enough to be browser chrome takes the cheap path
       instead: the canvases are resized, the layouts are kept, and the drift in
       minDim over sixty or eighty pixels is not visible.

       Debounced either way, because a drag of a desktop window edge delivers
       these by the dozen and each one is a rebuild. */
    let resizeTimer = 0;
    let lastW = 0, lastH = 0;
    const CHROME_H = 140;

    function onResize() {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        const cheap = w === lastW && Math.abs(h - lastH) <= CHROME_H;
        lastW = w; lastH = h;
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () {
            if (cheap) measure();
            else resize();
            kick();
        }, 140);
    }

    function radiusAt(level) {
        return BASE_R * Math.pow(SHRINK, level);
    }

    /* ---------- depth ---------- */

    /* A mass as deep as it is wide projects to a crowd of overlaps with nothing
       legible behind them, so the lineage spreads less in z than across. */
    const FLATTEN = 0.88;
    // focal length as a multiple of the frame: near cells read larger than far
    // ones, well short of the mass turning into a fisheye
    const FOCAL = 1.9;
    // the key light in cluster space: up, to the left, and in front of the mass
    const CL0 = -0.40, CL1 = -0.54, CL2 = -0.74;

    function project(cells, focal) {
        for (const c of cells) {
            const k = focal / (focal + c.z);
            c.px = c.x * k;
            c.py = c.y * k;
            c.pr = c.r * k;
        }
    }

    /* How lit each cell is, taken from where it sits in the mass rather than
       from its own surface. A cell on the lit face keeps the whole sprite; one
       behind it, or buried among neighbours, is drawn down toward the
       background. Every cell being shaded identically is what makes a ball of
       spheres read as a flat mosaic of beads, and this is the fix for it.

       Strength is relative to the brightest cell present, so a mass always has
       a fully lit face and a single cell on its own is never dimmed. */
    function litCluster(cells, near) {
        let span = 0.0001;
        for (const c of cells) {
            c.crowd = 0;
            const d = Math.hypot(c.x, c.y, c.z);
            if (d > span) span = d;
        }

        const near2 = near * near;
        for (let a = 0; a < cells.length; a++) {
            for (let b = a + 1; b < cells.length; b++) {
                const A = cells[a], B = cells[b];
                const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 >= near2) continue;
                // a soft count, so brightness never steps as the mass shifts
                const w = 1 - d2 / near2;
                A.crowd += w; B.crowd += w;
            }
        }

        let peak = 0.0001;
        for (const c of cells) {
            const face = (c.x * CL0 + c.y * CL1 + c.z * CL2) / span;
            c.lit = (0.4 + 0.6 * smooth(clamp01(face * 0.55 + 0.5)))
                * (1 - 0.4 * clamp01(c.crowd / 7))
                * (1 - 0.22 * clamp01(c.z / span));
            if (c.lit > peak) peak = c.lit;
        }
        for (const c of cells) c.lit /= peak;
    }

    /* How fast the page is being scrolled, in viewport heights per second,
       smoothed so that one coarse wheel notch does not read as a flick. */
    let vel = 0;
    let lastY = window.scrollY;
    let lastT = performance.now();

    function readVelocity(now, y) {
        const dt = Math.max(now - lastT, 1);
        // per-frame samples are noisy enough that the raw figure swings by a
        // factor of two between frames on a steady trackpad drag
        const inst = Math.abs(y - lastY) / dt * 1000 / Math.max(H, 1);
        lastY = y;
        lastT = now;
        vel += (inst - vel) * 0.2;
        return vel;
    }

    /* How hard a stage chases the scroll position it has been given.

       Both stages are pinned for several screens, and the progress they read is
       a fraction of that. Chasing it at one fixed rate means a visitor who
       flicks through spends a second watching the animation catch up to where
       they already are, which reads as the page being slow, while a visitor
       reading their way down does not need the responsiveness at all. So the
       rate scales with how fast the page is moving: gentle while someone is
       working through the captions, near-instant once they are travelling.

       Progress itself stays a pure function of scroll position, which is what
       keeps the sequence reversible and keeps a given caption tied to a given
       place on the page. Only the catch-up is velocity-dependent. */
    const EASE_SLOW = 0.11;
    const EASE_FAST = 0.55;

    function ease(cur, target) {
        const k = lerp(EASE_SLOW, EASE_FAST, clamp01(vel / 1.8));
        return cur + (target - cur) * k;
    }

    /* Front-loaded, so the first divisions arrive right after the hero instead
       of holding a single cell for most of a screen of scrolling. The exponent
       is set against the stage height: it buys the opening beats back the
       scroll that the longer middle of the sequence needs. */
    function readProgress(y) {
        return Math.pow(clamp01((y - sTop) / sTravel), 0.82);
    }

    /* ---------- phase 1: one cell becomes a tumor ---------- */

    /* Grown by repeatedly splitting whichever cells have run past the number of
       generations their own lineage is entitled to at this point in the scroll.
       Sweeping the whole population each pass, rather than walking a tree of
       fixed depth, is what lets one lineage sit still at four generations while
       another is on its ninth. */
    function buildCells(mp) {
        let cells = [{ x: 0, y: 0, z: 0, path: 0, depth: 0, sib: 0, sf: 1, r: 0, v: 0 }];

        for (let pass = 0; pass < MAX_GEN; pass++) {
            const next = [];
            let any = false;

            for (const c of cells) {
                const lin = lineageOf(c.path, c.depth);
                const over = budgetFor(lin ? lin.onset : null, mp) - c.depth;
                if (over <= 0) { next.push(c); continue; }
                any = true;

                // a generation rests, then pinches apart, so a settled cell
                // reads as one outline instead of two coincident ones
                const frac = smooth(clamp01((over - 0.28) / 0.62));
                const depth = c.depth + 1;
                // seeded on the parent, so the two daughters are identical
                // bodies while they still share a centre
                const seed = c.path + c.depth * 8191;

                // a direction on the sphere rather than in the plane, so a
                // lineage builds a ball of cells instead of a disc of them
                const u = hash(c.depth * 7919 + c.path * 3.71) * 2 - 1;
                const ang = hash(c.depth * 5417 + c.path * 9.13) * TAU;
                const ring = Math.sqrt(1 - u * u);
                const sep = radiusAt(depth) * minDim * 1.06 * frac;
                const dx = Math.cos(ang) * ring * sep;
                const dy = Math.sin(ang) * ring * sep;
                const dz = u * FLATTEN * sep;

                const v = Math.floor(hash(seed * 9.13 + 2.7) * SHAPES.length) % SHAPES.length;

                for (const s of [-1, 1]) {
                    next.push({
                        x: c.x + dx * s, y: c.y + dy * s, z: c.z + dz * s,
                        path: (c.path << 1) | (s > 0 ? 1 : 0),
                        depth, sib: seed, sf: frac, r: 0, v
                    });
                }
            }

            cells = next;
            if (!any) break;
        }

        sizeCells(cells);
        paint(cells, mp);
        relax(cells);
        recentre(cells);
        let mean = 0;
        for (const c of cells) mean += c.r;
        litCluster(cells, (mean / cells.length) * 2.3);
        project(cells, minDim * FOCAL);
        // the back of the mass is laid down first, so the front of it occludes
        cells.sort((a, b) => b.z - a.z);
        return { cells };
    }

    /* Size, once the whole population is known, since a cell is sized partly
       against how deep everything else got. The jitter is seeded on the parent
       so two daughters stay the same size as each other while they separate. */
    function sizeCells(cells) {
        let mean = 0;
        for (const c of cells) mean += c.depth;
        mean /= cells.length;
        for (const c of cells) {
            const eff = mean + (c.depth - mean) * DEPTH_MIX;
            c.r = radiusAt(eff) * minDim * (0.93 + 0.14 * hash(c.sib * 23.71 + 4.3));
        }
    }

    /* The finished tumor, which the last two acts both sit on top of and
       neither of which changes it. Rebuilding it per frame means relaxing a
       hundred cells against each other for a picture that is identical to the
       one before it, so it is built once and kept. */
    function fullyGrown() {
        if (!grown) grown = buildCells(1);
        return grown;
    }

    /* Colour, in two stages. A cell first takes the colour of the clone its
       lineage belongs to, and then, if it is part of a subclone, drifts off
       that colour onto its own shade. Going through the parent colour rather
       than straight to the shade is what makes the subclones read as having
       come out of the clone instead of having arrived from somewhere else. */
    function paint(cells, mp) {
        for (const c of cells) {
            const lin = lineageOf(c.path, c.depth);
            if (!lin) {
                c.pal0 = HEALTHY; c.pal = HEALTHY; c.m = 0; c.m2 = 0;
                continue;
            }
            // never quite the full clone colour, and never the same amount
            // twice, so a clone is a spread of related cells not a flat fill
            const spread = 0.66 + 0.34 * hash(c.sib * 17.3);
            const sub = lin.subclones ? subcloneOf(c.path, c.depth) : null;
            c.pal0 = lin.pal;
            c.pal = sub ? sub.pal : lin.pal;
            c.m = clamp01((mp - lin.onset) / MUT_RAMP) * spread;
            c.m2 = sub ? clamp01((mp - sub.onset) / 0.075) * c.m : 0;
        }
    }

    /* Cheap symmetric push-apart, plus a weak pull toward the centre so the
       cluster packs into a rounded mass instead of a straggling chain. */
    function relax(cells) {
        for (let iter = 0; iter < 7; iter++) {
            if (cells.length > 2) {
                let sx = 0, sy = 0, sz = 0;
                for (const c of cells) { sx += c.x; sy += c.y; sz += c.z; }
                const n = cells.length;
                const ox = sx / n, oy = sy / n, oz = sz / n;
                for (const c of cells) {
                    c.x = ox + (c.x - ox) * 0.968;
                    c.y = oy + (c.y - oy) * 0.968;
                    c.z = oz + (c.z - oz) * 0.968;
                }
            }
            for (let a = 0; a < cells.length; a++) {
                for (let b = a + 1; b < cells.length; b++) {
                    const A = cells[a], B = cells[b];
                    // sibling pairs are exempt while separating, then eased in
                    const isSib = A.sib === B.sib;
                    const scale = isSib ? clamp01((Math.min(A.sf, B.sf) - 0.88) / 0.12) : 1;
                    if (scale === 0) continue;
                    // per pair, because lineages that divided at different
                    // rates are carrying cells of quite different sizes
                    const minDist = (A.r + B.r) * 0.86;
                    let dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
                    let d = Math.hypot(dx, dy, dz);
                    if (d > minDist) continue;
                    if (d < 0.0001) {
                        dx = (hash(A.sib * 3.7) - 0.5) * 0.1; dy = 0.1; dz = 0;
                        d = Math.hypot(dx, dy, dz);
                    }
                    const push = (minDist - d) * 0.32 * scale / d;
                    A.x -= dx * push; A.y -= dy * push; A.z -= dz * push;
                    B.x += dx * push; B.y += dy * push; B.z += dz * push;
                }
            }
        }
    }

    function recentre(cells) {
        let sx = 0, sy = 0, sz = 0;
        for (const c of cells) { sx += c.x; sy += c.y; sz += c.z; }
        const n = cells.length;
        const ox = sx / n, oy = sy / n, oz = sz / n;
        for (const c of cells) { c.x -= ox; c.y -= oy; c.z -= oz; }
    }

    function boundsRadius(cells) {
        let max = 0;
        for (const c of cells) max = Math.max(max, Math.hypot(c.px, c.py) + c.pr);
        return max;
    }

    /* ---------- cell rendering ---------- */

    /* A cell is a sphere shaded once per pixel and kept as a sprite: a Lambert
       term with the light wrapped past the terminator, a tight specular, a
       Fresnel edge, and light carried through the body so the thin limb glows
       the way anything translucent does. The nucleus is resolved as a second
       sphere sitting inside the first, faded by the depth of cytoplasm still in
       front of it, which is what sets it into the cell rather than on top.

       Because a cell is then a single drawImage, division needs no special
       case: the two daughters start on the same centre with the same sprite,
       so they read as the one cell they came from, and neither one's shading
       changes as they pull apart. */

    // key light, and the half vector against a straight-on viewer
    const L0 = -0.40, L1 = -0.54, L2 = 0.74;
    const HL = Math.hypot(L0, L1, L2 + 1);
    const H0 = L0 / HL, H1 = L1 / HL, H2 = (L2 + 1) / HL;
    // a weak fill from the opposite side, so the shadow half turns rather than
    // just falling off, which is the difference between a sphere and a disc
    const F0 = 0.58, F1 = 0.46, F2 = 0.67;

    // margin around the sphere for the shadow it lays on whatever is behind it
    const PAD = 0.18;
    const SPAN = 1 + PAD;

    // a sprite is baked at the smallest of these that still covers the cell on
    // screen, so a tumor of small cells never pays for detail it cannot show.
    // a sphere is smooth enough to be stretched a little past its own size
    // before the softness shows, which SLACK allows for
    const TIERS = [64, 144, 320, 576];
    const SLACK = 1.55;

    /* Outline wobble, nucleus offset and nucleus size, so a mass is not one
       cell stamped out repeatedly. Siblings share a variant, which is what lets
       two daughters on the same centre read as a single body. */
    const SHAPES = [
        { amp: 0.018, lobes: 4, ph: 0.4, nx: 0.13, ny: 0.06, nr: 0.34 },
        { amp: 0.024, lobes: 5, ph: 2.1, nx: -0.06, ny: 0.15, nr: 0.32 },
        { amp: 0.015, lobes: 3, ph: 3.9, nx: 0.16, ny: -0.03, nr: 0.36 },
        { amp: 0.021, lobes: 4, ph: 5.2, nx: 0.02, ny: -0.13, nr: 0.31 },
        { amp: 0.013, lobes: 6, ph: 1.2, nx: -0.14, ny: -0.05, nr: 0.35 }
    ];

    const sprites = new Map();

    /* ---------- baked sprites ---------- */

    /* Cells are blitted from an atlas of offline 3D renders: a displaced
       membrane lit in a small studio, with the nucleus showing through it.
       One row per palette, one column per outline variant, which is the pair
       the cache below is already keyed on.

       Everything downstream of this is unchanged, because a baked cell is
       still one image drawn at one size. The shader further down stays as the
       fallback and runs until the atlas arrives, or forever if it never does,
       so the sequence is never waiting on a download to start moving.

       The large atlas is healthy cells only. Nothing has mutated yet while
       cells are still big enough to need it: the earliest clone onset is most
       of the way through the first phase, by which point a cell is a third of
       the size it opened at. */
    const atlas = {
        main: null, mainTile: 320,
        lg: null, lgTile: 576,
        ready: false
    };

    function loadAtlas() {
        let pending = 2;
        const done = () => {
            if (--pending) return;
            if (!atlas.main) return;
            atlas.ready = true;
            // anything the fallback shader baked while this was in flight is
            // the old look, and has to go
            sprites.clear();
            shades.clear();
            prebake();
            // the loop may have stood down while this was downloading, and the
            // frame on screen was drawn with the shader it has just replaced
            kick();
        };
        const grab = (src, key) => {
            const img = new Image();
            img.onload = () => { atlas[key] = img; done(); };
            img.onerror = done;
            img.src = src;
        };
        grab('cells.webp', 'main');
        grab('cells-lg.webp', 'lg');
    }

    /* One cell out of the atlas at the size it is about to be shown at. Never
       enlarged past the tile it came from: drawing a 320 tile into a 576 canvas
       would cost the memory of the larger tier without carrying any more
       detail than the smaller one already has. */
    function cutSprite(pal, variant, size) {
        const useLg = atlas.lg && pal === HEALTHY && size > atlas.mainTile;
        const src = useLg ? atlas.lg : atlas.main;
        const tile = useLg ? atlas.lgTile : atlas.mainTile;
        const sy = useLg ? 0 : pal.id * tile;
        const out = Math.min(size, tile);

        const cv = document.createElement('canvas');
        cv.width = cv.height = out;
        const g = cv.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(src, variant * tile, sy, tile, tile, 0, 0, out, out);
        return cv;
    }

    /* The silhouette, taken from the baked cell's own alpha so it lines up with
       it exactly. Thresholded above the contact shadow, which lives in the same
       alpha channel and must not be darkened a second time. */
    function cutShade(variant, size) {
        const cv = cutSprite(HEALTHY, variant, size);
        const g = cv.getContext('2d');
        let img;
        try {
            img = g.getImageData(0, 0, cv.width, cv.height);
        } catch (e) {
            // opened over file://, so the atlas has tainted the canvas
            return buildShade(SHAPES[variant], size);
        }
        const d = img.data;
        const oc = ground.occlude;
        for (let i = 0; i < d.length; i += 4) {
            const a = (d[i + 3] / 255 - 0.6) / 0.4;
            d[i] = oc[0]; d[i + 1] = oc[1]; d[i + 2] = oc[2];
            d[i + 3] = a <= 0 ? 0 : a >= 1 ? 255 : (a * 255) | 0;
        }
        g.putImageData(img, 0, 0);
        return cv;
    }

    // the two exponentials in the loop only ever take one argument each, so
    // they are tabulated once instead of evaluated per pixel
    const EXP = new Float32Array(258);
    for (let i = 0; i <= 257; i++) EXP[i] = Math.exp(-i / 64);
    const decay = t => EXP[t <= 0 ? 0 : t > 4 ? 256 : (t * 64) | 0];

    function buildSprite(pal, shape, size) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const g = cv.getContext('2d');
        const img = g.createImageData(size, size);
        const data = img.data;

        const deep = pal.deep, mid = pal.mid, core = pal.core, rim = pal.edge;
        // the nucleus is denser than the cytoplasm around it, so it is carried
        // most of the way toward the palette's deepest tone
        const nuc = [
            chan(pal.nuc, deep, 0.54, 0),
            chan(pal.nuc, deep, 0.54, 1),
            chan(pal.nuc, deep, 0.54, 2)
        ];

        const half = size / 2;
        const R = half / SPAN;
        const aa = 1.5 / R;
        // a mutated cell carries a looser outline and a larger nucleus: a high
        // nuclear-to-cytoplasmic ratio is the classic look down a microscope
        const mal = pal !== HEALTHY;
        const amp = shape.amp * (mal ? 1.3 : 1);
        const nr = shape.nr * (mal ? 1.15 : 1);
        const nr2 = nr * nr;
        // the nucleus sits below the front surface, close enough that the
        // cytoplasm over it stays thin and it does not wash out
        const nzc = 0.3;

        for (let py = 0; py < size; py++) {
            const y = (py + 0.5 - half) / R;
            for (let px = 0; px < size; px++) {
                const x = (px + 0.5 - half) / R;
                const i = (py * size + px) * 4;
                const ang = Math.atan2(y, x);
                const edge = 1
                    + amp * Math.sin(ang * shape.lobes + shape.ph)
                    + amp * 0.5 * Math.sin(ang * (shape.lobes + 2) - shape.ph);
                const nx = x / edge, ny = y / edge;
                const u2 = nx * nx + ny * ny;

                if (u2 >= 1) {
                    // contact shadow, pushed away from the light so it reads as
                    // cast by the cell rather than as a halo around it
                    const t = (Math.hypot(x + L0 * 0.13, y + L1 * 0.13) / edge - 1) / PAD;
                    if (t >= 0 && t < 1) {
                        const k = (1 - t) * (1 - t) * 0.44;
                        data[i] = 4; data[i + 1] = 9; data[i + 2] = 18;
                        data[i + 3] = (k * 255) | 0;
                    }
                    continue;
                }

                const nz = Math.sqrt(1 - u2);
                const ndl = nx * L0 + ny * L1 + nz * L2;
                const diff = ndl > 0 ? ndl : 0;
                // light wrapping past the terminator, so the dark side keeps the
                // soft falloff of something light passes through
                const wrap = ndl > -0.5 ? (ndl + 0.5) / 1.5 : 0;
                const shade = 0.05 + 0.28 * wrap + 0.70 * diff;

                // deep through mid across the shadowed half, then only part way
                // to the palette's lightest tone, so a lit cell keeps its hue
                // instead of washing out to white
                let r, gr, b;
                if (shade < 0.56) {
                    const t = shade / 0.56;
                    r = deep[0] + (mid[0] - deep[0]) * t;
                    gr = deep[1] + (mid[1] - deep[1]) * t;
                    b = deep[2] + (mid[2] - deep[2]) * t;
                } else {
                    const t = Math.min(0.86, (shade - 0.56) / 0.6);
                    r = mid[0] + (core[0] - mid[0]) * t;
                    gr = mid[1] + (core[1] - mid[1]) * t;
                    b = mid[2] + (core[2] - mid[2]) * t;
                }

                // light carried through the body: strongest where it is
                // thinnest, and strongest again on the side facing away from
                // the light, which is the side it has to travel through
                const trans = decay(3.4 * nz) * 0.3 * (0.5 + 0.7 * (1 - wrap));
                // and the grazing edge going bright, as any translucent thing does
                const f = 1 - nz;
                const fres = f * f * f * 0.3;
                const ndf = nx * F0 + ny * F1 + nz * F2;
                const fill = ndf > 0 ? ndf * ndf * 0.17 : 0;
                r += mid[0] * trans + rim[0] * fres + rim[0] * fill;
                gr += mid[1] * trans + rim[1] * fres + rim[1] * fill;
                b += mid[2] * trans + rim[2] * fres + rim[2] * fill;

                const qx = nx - shape.nx, qy = ny - shape.ny;
                const q2 = qx * qx + qy * qy;
                if (q2 < nr2) {
                    const mz = Math.sqrt(nr2 - q2);
                    // cytoplasm still in front of the nucleus here: thin over
                    // its centre, thick at its edge, so it fades into the body
                    // instead of ending on a line
                    const above = nz - (nzc + mz);
                    const att = Math.min(0.86, decay(1.7 * (above > 0 ? above : 0)) * 1.55);
                    const mnz = mz / nr;
                    const mdl = (qx * L0 + qy * L1) / nr + mnz * L2;
                    // barely directional: by the time light reaches the nucleus
                    // it has scattered through the cytoplasm, and a strong
                    // gradient here is what makes a nucleus read as a bump
                    // sitting on the cell rather than a body inside it
                    const ms = 0.66 + 0.32 * (mdl > -0.5 ? (mdl + 0.5) / 1.5 : 0);
                    r += (nuc[0] * ms - r) * att;
                    gr += (nuc[1] * ms - gr) * att;
                    b += (nuc[2] * ms - b) * att;
                } else {
                    // the nucleus blocking internal light leaves a soft seat
                    // around itself, so it looks embedded and not printed on
                    const o = decay((Math.sqrt(q2) - nr) * 6) * 0.22;
                    const k = 1 - o;
                    r *= k; gr *= k; b *= k;
                }

                const ndh = nx * H0 + ny * H1 + nz * H2;
                if (ndh > 0) {
                    // ndh^26 and ndh^6 by squaring, which the specular is far
                    // too hot a term to be paying Math.pow for per pixel
                    const p2 = ndh * ndh, p4 = p2 * p2, p8 = p4 * p4;
                    const s = p8 * p8 * p8 * p2 * 76 + p4 * p2 * 11;
                    r += s; gr += s; b += s;
                }

                const u = Math.sqrt(u2);
                data[i] = r > 255 ? 255 : r;
                data[i + 1] = gr > 255 ? 255 : gr;
                data[i + 2] = b > 255 ? 255 : b;
                data[i + 3] = u > 1 - aa ? ((1 - u) / aa * 255) | 0 : 255;
            }
        }

        g.putImageData(img, 0, 0);
        return cv;
    }

    // shading a sprite is the one expensive thing here, so a frame bakes only a
    // couple; anything else falls back to a smaller one already cached and is
    // stretched up for a frame or two until its own is ready
    const BAKE_BUDGET = 2;
    let baked = 0;

    function spriteKey(pal, variant, tier) {
        return (pal.id * SHAPES.length + variant) * TIERS.length + tier;
    }

    function tierFor(radius) {
        const need = radius * pxScale;
        for (let i = 0; i < TIERS.length; i++) {
            if (TIERS[i] / 2 / SPAN * SLACK >= need) return i;
        }
        return TIERS.length - 1;
    }

    function spriteFor(pal, variant, radius) {
        const want = tierFor(radius);
        const key = spriteKey(pal, variant, want);
        let sp = sprites.get(key);
        if (sp) return sp;

        // cutting one out of the atlas is a single blit, so it needs none of
        // the budgeting the shader below does
        if (atlas.ready) {
            sp = cutSprite(pal, variant, TIERS[want]);
            sprites.set(key, sp);
            return sp;
        }

        if (baked >= BAKE_BUDGET) {
            for (let i = want - 1; i >= 0; i--) {
                sp = sprites.get(spriteKey(pal, variant, i));
                if (sp) return sp;
            }
        }

        baked++;
        sp = buildSprite(pal, SHAPES[variant], TIERS[want]);
        sprites.set(key, sp);
        return sp;
    }

    /* The silhouette on its own, in the colour a cell falls toward once the
       mass in front of it has taken its light. Laid over a cell at whatever
       strength its place in the mass calls for, which costs one small sprite
       per outline instead of a whole set baked per level of shadow. */
    const shades = new Map();

    function buildShade(shape, size) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const g = cv.getContext('2d');
        const img = g.createImageData(size, size);
        const data = img.data;
        const oc = ground.occlude;
        const half = size / 2;
        const R = half / SPAN;
        const aa = 1.5 / R;

        for (let py = 0; py < size; py++) {
            const y = (py + 0.5 - half) / R;
            for (let px = 0; px < size; px++) {
                const x = (px + 0.5 - half) / R;
                const ang = Math.atan2(y, x);
                const edge = 1
                    + shape.amp * Math.sin(ang * shape.lobes + shape.ph)
                    + shape.amp * 0.5 * Math.sin(ang * (shape.lobes + 2) - shape.ph);
                const u = Math.hypot(x, y) / edge;
                if (u >= 1) continue;
                const i = (py * size + px) * 4;
                data[i] = oc[0]; data[i + 1] = oc[1]; data[i + 2] = oc[2];
                data[i + 3] = u > 1 - aa ? ((1 - u) / aa * 255) | 0 : 255;
            }
        }

        g.putImageData(img, 0, 0);
        return cv;
    }

    /* Keyed on the ground as well as the outline, because the two stages want
       opposite occlusion and both are on screen within a scroll of each other. */
    function shadeFor(variant, tier) {
        const key = ground.occlude[0] * 4096 + variant * TIERS.length + tier;
        let sp = shades.get(key);
        if (!sp) {
            sp = atlas.ready ? cutShade(variant, TIERS[tier])
                : buildShade(SHAPES[variant], TIERS[tier]);
            shades.set(key, sp);
        }
        return sp;
    }

    /* Mutation is a cross-fade from the healthy body to the clone's, rather
       than a sprite baked per shade. Every term above is linear in the palette
       it is given, so blending the two renders lands on the same colour that
       shading against a blended palette would have, for two bakes instead of
       one per step of the transition. */
    function drawCell(c) {
        const w = c.pr * SPAN * 2;
        const x = c.px - w / 2, y = c.py - w / 2;
        if (c.m < 0.995) dctx.drawImage(spriteFor(HEALTHY, c.v, c.pr), x, y, w, w);
        if (c.m > 0.005) {
            dctx.globalAlpha = c.m < 1 ? c.m : 1;
            dctx.drawImage(spriteFor(c.pal0, c.v, c.pr), x, y, w, w);
            dctx.globalAlpha = 1;
        }
        // the second stage: a subclone coming off the colour of the clone it
        // separated from, laid over that colour rather than over the healthy body
        if (c.m2 > 0.005) {
            dctx.globalAlpha = c.m2 < 1 ? c.m2 : 1;
            dctx.drawImage(spriteFor(c.pal, c.v, c.pr), x, y, w, w);
            dctx.globalAlpha = 1;
        }
        if (c.lit < 0.995) {
            dctx.globalAlpha = 1 - c.lit;
            dctx.drawImage(shadeFor(c.v, tierFor(c.pr)), x, y, w, w);
            dctx.globalAlpha = 1;
        }
    }

    function drawAura(bound, tint, strength) {
        const g = dctx.createRadialGradient(0, 0, bound * 0.2, 0, 0, bound * 1.9);
        g.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},${strength})`);
        g.addColorStop(1, ground.fade);
        dctx.beginPath();
        dctx.arc(0, 0, bound * 1.9, 0, TAU);
        dctx.fillStyle = g;
        dctx.fill();
    }

    /* Average of every cell's current colour, used for the glow behind a mass. */
    function auraTint(cells) {
        let r = 0, g = 0, b = 0, m = 0;
        for (const c of cells) {
            // the colour the two-stage blend actually lands on
            const mid = c.m2 > 0.005
                ? [chan(c.pal0.mid, c.pal.mid, c.m2, 0),
                   chan(c.pal0.mid, c.pal.mid, c.m2, 1),
                   chan(c.pal0.mid, c.pal.mid, c.m2, 2)]
                : c.pal0.mid;
            r += chan(HEALTHY.mid, mid, c.m, 0);
            g += chan(HEALTHY.mid, mid, c.m, 1);
            b += chan(HEALTHY.mid, mid, c.m, 2);
            m += c.m;
        }
        const n = cells.length;
        return { tint: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], avgM: m / n };
    }

    function drawCluster(cells) {
        for (const c of cells) drawCell(c);
    }

    /* ---------- phase 2: cells leave the mass ---------- */

    /* Routes out of the tumor, and the cells that take them. Both are seeded
       once per layout: the vessels are three bowed channels leaving the mass at
       different headings, and each escaping cell is given one of them, a moment
       to leave at, and a point along it to stop. Several cells stopping near
       the end of the same route is what builds the colony there, so there is no
       separate notion of a secondary tumor: it is just where the cells got to. */
    function initSpread() {
        const rnd = rng(4409);
        /* Destinations are placed against the frame rather than struck off at
           a heading and a distance: the mass does not sit in the middle of the
           canvas, so a fixed distance puts two routes out of shot on the wide
           layout and all three of them out on the narrow one.

           Vertically these are fractions of the figure's own band rather than of
           the box, because on the narrow layout the band is the part of the box
           the figure has: a colony placed against the frame there lands on the
           strip along the top or in the prose underneath. On the wide layout the
           band is the box and the two are the same thing. */
        const dest = wide
            ? [[0.90, 0.12], [0.93, 0.56], [0.82, 0.93]]
            : [[0.88, 0.12], [0.92, 0.54], [0.12, 0.34]];

        const cyy = figCy();

        const routes = dest.map((d, i) => {
            const ex = fx + fw * d[0], ey = figTop + figBand * d[1];
            const dx = ex - cx, dy = ey - cyy;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len, uy = dy / len;
            // routes leave from around the mass rather than from a point in
            // the middle of it, which is the difference between vessels
            // running past a tumor and a starburst
            const sx = cx + ux * minDim * 0.15 - uy * (rnd() - 0.5) * minDim * 0.16;
            const sy = cyy + uy * minDim * 0.15 + ux * (rnd() - 0.5) * minDim * 0.16;
            // and bowed well off the straight line for the same reason
            const bow = (rnd() < 0.5 ? -1 : 1) * len * (0.20 + rnd() * 0.22);
            return {
                sx, sy, ex, ey,
                mx: (sx + ex) / 2 - uy * bow,
                my: (sy + ey) / 2 + ux * bow,
                // one of the three is lymphatic, the rest carry blood
                lymph: i === 1
            };
        });

        const tints = [PALETTES.primary].concat(SUBS.map(s => s.pal));
        const escapees = [];
        for (let i = 0; i < 15; i++) {
            const pal = tints[i % tints.length];
            escapees.push({
                route: routes[i % routes.length],
                pal,
                // staggered, so cells trickle out over the whole beat instead
                // of leaving in one wave
                t0: 0.04 + rnd() * 0.40,
                dur: 0.28 + rnd() * 0.24,
                // a narrow band, so cells that take the same route end up in
                // the same place and the arrivals read as a colony
                stop: 0.84 + rnd() * 0.16,
                off: (rnd() - 0.5) * minDim * 0.085,
                phase: rnd() * TAU,
                size: 0.86 + rnd() * 0.3,
                lit: 0.72 + rnd() * 0.28,
                v: Math.floor(rnd() * SHAPES.length) % SHAPES.length
            });
        }

        spread = { routes, escapees };
    }

    function bez(t, a, b, c) {
        const s = 1 - t;
        return s * s * a + 2 * s * t * b + t * t * c;
    }

    function drawVessel(r, alpha) {
        const g = ctx.createLinearGradient(r.sx, r.sy, r.ex, r.ey);
        const tone = r.lymph ? '120,178,186' : '186,84,96';
        // a mid tone at this alpha is a whisper on blue and nothing at all on
        // paper, so the paper ground asks for more of it
        const a = alpha * ground.vessel;
        // faded at both ends, so a route reads as a channel passing through the
        // frame rather than a stroke that starts and stops
        g.addColorStop(0, `rgba(${tone},0)`);
        g.addColorStop(0.35, `rgba(${tone},${0.13 * a})`);
        g.addColorStop(0.75, `rgba(${tone},${0.09 * a})`);
        g.addColorStop(1, `rgba(${tone},0)`);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(r.sx, r.sy);
        ctx.quadraticCurveTo(r.mx, r.my, r.ex, r.ey);
        ctx.lineWidth = minDim * 0.028;
        ctx.lineCap = 'round';
        ctx.strokeStyle = g;
        ctx.stroke();
        ctx.restore();
    }

    /* The figure: a finished tumor, with the cells that have left it already
       arrived where they were going.

       This was three screens of scrolling once, one healthy cell dividing its way
       to a patchwork of clones and then seeding colonies away from it, and the
       reader had to crank all of it. It is one picture now. The growth was the
       part that needed the scroll, and the growth is not what the caption is
       about: the finished thing is, and a finished thing is a figure. */
    function renderFigure() {
        if (!spread) initSpread();

        noteBoxes.length = 0;

        for (const r of spread.routes) drawVessel(r, 1);

        const mass = renderMass();

        // kept as they are drawn, so the name below can be hung off one of these
        // cells rather than off the point the route was aimed at
        const landed = [];

        for (const e of spread.escapees) {
            const t = e.stop;
            const r = e.route;
            // perpendicular drift, so cells on one route do not run in file
            const nx = r.ey - r.sy, ny = r.sx - r.ex;
            const nl = Math.hypot(nx, ny) || 1;
            const w = e.off * Math.sin(t * 3.1 + e.phase);

            scratch.px = bez(t, r.sx, r.mx, r.ex) + (nx / nl) * w;
            scratch.py = bez(t, r.sy, r.my, r.ey) + (ny / nl) * w;
            scratch.pr = mass.cellR * mass.k * e.size;
            scratch.m = 1;
            scratch.m2 = 0;
            scratch.pal = e.pal;
            scratch.pal0 = e.pal;
            scratch.v = e.v;
            scratch.lit = e.lit;

            landed.push({ route: r, x: scratch.px, y: scratch.py, r: scratch.pr });
            drawCell(scratch);
        }

        /* Every name on the figure is placed here, after the whole of it is drawn,
           and against a map of what the drawing has already taken. Naming as each
           part went down meant the first names were placed against an empty canvas
           and the cells arrived underneath them. */
        occupy(mass.cells, cx, figCy(), mass.k);
        for (const c of landed) noteBoxes.push({ x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2 });

        /* The prose, which is the other thing on this screen. It is a column down
           the left on a wide layout and a block under the figure on a narrow one,
           and either way a name set into it is set on top of the sentence the
           figure is illustrating. */
        if (wide) noteBoxes.push({ x: fx, y: 0, w: fw * 0.30, h: H });
        else noteBoxes.push({ x: fx, y: figTop + figBand, w: fw, h: H - figTop - figBand });

        for (const b of chromeBoxes) noteBoxes.push(b);

        // outside the mass transform, so a name is set at its own size rather than
        // at whatever the camera happens to be doing to the cells
        annotateClones(mass.cells, mass.k);

        /* Named at a colony, where the cells have got to, rather than at the mass
           they left: leaving is what the vessels show already, and being somewhere
           else is the part that is the point.

           This one leads inward, back toward the mass, where every other name on
           the figure leads outward from it. The colonies are what the routes are
           for and the routes all run to the same side of the frame, so all three
           colonies sit hard against its edge: there is no paper out there to name
           into, and a name pushed out anyway comes back set over the cells it is
           pointing at. The paper is on the inside, in the gap the route crosses,
           and a leader running from a colony back to the mass happens to say the
           right thing about where the cells in it came from.

           The colony nearest the mass's own height gets it, which keeps the name
           clear of both the top of the frame and the way out at the bottom. */
        if (landed.length) {
            const cyy = figCy();
            let route = spread.routes[0];
            for (const r of spread.routes) {
                if (Math.abs(r.ey - cyy) < Math.abs(route.ey - cyy)) route = r;
            }

            const dx = cx - route.ex, dy = cyy - route.ey;
            const d = Math.hypot(dx, dy) || 1;
            const ux = dx / d, uy = dy / d;

            /* The colony's own cells, nearest the way back first, so the leader
               ends on the near side of it and runs through the gap the route
               crossed rather than back out through the colony. */
            const pts = landed.filter(c => c.route === route)
                .map(c => ({ x: c.x, y: c.y, along: c.x * ux + c.y * uy }))
                .sort((a, b) => b.along - a.along);

            // out into the middle of the gap the route crosses, which is the paper
            // this name has; a fixed lead leaves it sitting on its own colony
            const back = Math.max(noteLead(), d * 0.34);
            if (pts.length) drawNote('metastases', pts, ux, uy, back, noteSize());
        }
    }

    /* ---------- phase 3: a cohort of other patients ---------- */

    /* A tumor built in normalised space (fits inside a unit circle): a blobby
       outline, a handful of subclone patches, and a rim of normal tissue. */
    function buildLayout(seed) {
        const rnd = rng(seed);
        // some patients are effectively one clone, some are split in two,
        // some are a four-way mosaic
        const cloneCount = [1, 2, 2, 3, 3, 4][Math.floor(rnd() * 6)];
        const start = Math.floor(rnd() * CLONES.length);
        const step = 1 + Math.floor(rnd() * 3);
        const spin = rnd() * TAU;
        const patches = [];
        for (let i = 0; i < cloneCount; i++) {
            // spread the patch seeds so clones hold coherent territory
            const a = spin + (i / cloneCount) * TAU + (rnd() - 0.5) * 0.5;
            const d = cloneCount === 1 ? 0 : 0.34 + rnd() * 0.4;
            patches.push({
                x: Math.cos(a) * d,
                y: Math.sin(a) * d,
                pal: CLONES[(start + i * step) % CLONES.length]
            });
        }

        const n = 55 + Math.floor(rnd() * 80);
        const cr = 0.95 / Math.sqrt(n);
        const aspect = 0.78 + rnd() * 0.46;
        // enough to keep every outline distinct, short of the lobes reading as
        // a splatter rather than a mass
        const rough = 0.08 + rnd() * 0.18;
        const lobes = 3 + Math.floor(rnd() * 3);
        const ph1 = rnd() * TAU, ph2 = rnd() * TAU;
        const normalFrac = rnd() * 0.35;
        const edge = a => 1 + rough * Math.sin(a * lobes + ph1) + rough * 0.5 * Math.sin(a * (lobes + 3) + ph2);
        const inside = (x, y) => Math.hypot(x / aspect, y) <= edge(Math.atan2(y, x)) - cr;

        const cells = [];
        let guard = 0;
        while (cells.length < n && guard++ < n * 80) {
            const x = rnd() * 2 - 1, y = rnd() * 2 - 1;
            if (inside(x, y)) cells.push({ x, y });
        }

        const minDist = cr * 1.86;
        for (let iter = 0; iter < 14; iter++) {
            for (let a = 0; a < cells.length; a++) {
                for (let b = a + 1; b < cells.length; b++) {
                    const A = cells[a], B = cells[b];
                    let dx = B.x - A.x, dy = B.y - A.y;
                    let d = Math.hypot(dx, dy);
                    if (d > minDist) continue;
                    if (d < 1e-6) { dx = 0.001; dy = 0.001; d = Math.hypot(dx, dy); }
                    const push = (minDist - d) * 0.3 / d;
                    A.x -= dx * push; A.y -= dy * push;
                    B.x += dx * push; B.y += dy * push;
                }
            }
            for (const c of cells) {
                const lim = edge(Math.atan2(c.y, c.x)) - cr;
                const rad = Math.hypot(c.x / aspect, c.y);
                if (rad > lim) { const k = lim / rad; c.x *= k; c.y *= k; }
            }
        }

        let maxR = 0.0001;
        for (const c of cells) {
            let best = patches[0], bd = Infinity;
            for (const q of patches) {
                const d = Math.hypot(c.x - q.x, c.y - q.y) * (0.95 + rnd() * 0.1);
                if (d < bd) { bd = d; best = q; }
            }
            // no two-stage blend out here: another patient's tumor is shown as
            // it ended up, not as it got there
            c.pal = best.pal;
            c.pal0 = best.pal;
            c.m2 = 0;
            const rim = Math.hypot(c.x, c.y) > 0.68;
            c.m = rim && rnd() < normalFrac ? 0.08 + rnd() * 0.14 : 0.66 + rnd() * 0.34;
            c.r = cr * (0.86 + rnd() * 0.3);
            c.v = Math.floor(rnd() * SHAPES.length) % SHAPES.length;
            // a dome rather than a sheet: cells near the middle of a tumor sit
            // anywhere through its thickness, cells at its rim are edge on
            const lift = Math.sqrt(Math.max(0, 1 - Math.hypot(c.x, c.y) * 0.9));
            c.z = (rnd() * 2 - 1) * lift * 0.62;
            maxR = Math.max(maxR, Math.hypot(c.x, c.y) + c.r);
        }

        litCluster(cells, cr * 2.3);
        project(cells, maxR * FOCAL);
        // normalised off the projected extent, since the near face of the mass
        // grows under the perspective and would otherwise overrun its slot
        let fit = 0.0001;
        for (const c of cells) fit = Math.max(fit, Math.hypot(c.px, c.py) + c.pr);
        for (const c of cells) { c.px /= fit; c.py /= fit; c.pr /= fit; }
        cells.sort((a, b) => b.z - a.z);

        return { cells, cloneCount, id: 1020 + Math.floor(rnd() * 8600) };
    }

    // borrowed by anything that draws a cell it does not own, so the escaping
    // cells and the like do not each allocate one per frame
    const scratch = { px: 0, py: 0, pr: 0, m: 0, m2: 0, pal: null, pal0: null, v: 0, lit: 1 };

    function drawLayout(layout, pxRadius) {
        for (const c of layout.cells) {
            scratch.px = c.px * pxRadius;
            scratch.py = c.py * pxRadius;
            scratch.pr = c.pr * pxRadius * 1.1;
            scratch.m = c.m;
            scratch.m2 = c.m2 || 0;
            scratch.pal = c.pal;
            scratch.pal0 = c.pal0 || c.pal;
            scratch.v = c.v;
            scratch.lit = c.lit;
            drawCell(scratch);
        }
    }

    /* ---------- the same tumors, as stained sections ---------- */

    /* Used by the second stage, where every tumor in the grid is cut and
       stained in place. The tissue itself is real: regions off TCGA breast
       cancer diagnostic slides, masked into the outline the tumor's own cells
       make, so a section keeps the shape the mass had while what is inside it
       is an actual stain rather than an impression of one.

       Nothing about the clone a cell belongs to survives into the section,
       which is right. The heterogeneity is still in the tissue. You would not
       call it off the stain, which is the point of everything after this.

       Two atlases, on the same argument as the cell sprites: the twenty in the
       grid are small and share a sheet of tiles, the one held up at the end is
       three times the width and gets its own. */
    /* Four files, but a section only needs two of them.

       The washed copies are a separate 410KB, and they used to be counted into
       the same readiness flag as the colour tissue, which meant the twenty
       sections in the grid could not be baked — and so the cohort could not
       appear at all — until the grey atlases had also finished downloading.
       Nothing wants them until the beat after the stain lands, so they are
       tracked apart and the wash is baked when they arrive.

       They are not derived from the colour ones. The grey files are desaturated
       and then brought back up to a mean of 128, where the colour tissue sits at
       86, so a grayscale filter over the colour atlas lands about six percent
       off across the frame and the washed slide comes out muddy. */
    const HE = {
        grid: null, tile: 320, cols: 4, count: 8,
        lg: null, gridGray: null, lgGray: null,
        settled: false,
        grayReady: false
    };

    function loadStains() {
        if (HE.pending != null) return;
        HE.pending = 2;
        HE.grayPending = 2;

        const colour = () => {
            if (--HE.pending) return;
            HE.settled = true;
            kick();
        };
        const washed = () => {
            if (--HE.grayPending) return;
            HE.grayReady = true;
            kick();
        };
        const grab = (src, key, done) => {
            const img = new Image();
            img.onload = () => { HE[key] = img; done(); };
            img.onerror = done;
            img.src = src;
        };

        grab('he.webp', 'grid', colour);
        grab('he-lg.webp', 'lg', colour);
        grab('he-gray.webp', 'gridGray', washed);
        grab('he-lg-gray.webp', 'lgGray', washed);
    }

    // only reached if the tissue never downloaded, and only so that a section
    // is still a section rather than a hole
    const EOSIN = [120, 66, 84];
    const HEMA = [54, 42, 92];

    /* The outline a section is cut to: the union of a disc per cell, faded over
       its own edge. It is built as bare alpha and the tissue is composited into
       it, which is why the border comes out scalloped the way a real one does
       instead of following some circle the layout never had. */
    function cutMask(g, cells, R, rScale, d) {
        for (const c of cells) {
            const x = c.px * R, y = c.py * R;
            const r = c.pr * R * rScale * (1.9 + (d - 1) * 0.16);
            const grd = g.createRadialGradient(x, y, r * 0.7, x, y, r);
            grd.addColorStop(0, '#fff');
            grd.addColorStop(1, 'rgba(255,255,255,0)');
            g.beginPath();
            g.arc(x, y, r, 0, TAU);
            g.fillStyle = grd;
            g.fill();
        }
    }

    /* A window onto one of the tiles. Which tile, which way up and how far in
       all come off the slide seed, because eight tiles have to carry twenty
       patients and two sections off the same tile must not be the same
       picture. */
    function drawStain(g, R, s, box, big, gray) {
        const grid = gray ? HE.gridGray : HE.grid;
        const large = gray ? HE.lgGray : HE.lg;
        const img = big && large ? large : grid;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (img === grid) {
            const i = Math.floor(s() * HE.count) % HE.count;
            sw = sh = HE.tile;
            sx = (i % HE.cols) * HE.tile;
            sy = Math.floor(i / HE.cols) * HE.tile;
        }
        // no zoom on the large one: it is already being drawn close to the
        // size it was cut at, and cropping into it would only soften it
        const z = big ? 1 : 0.76 + s() * 0.24;
        const ox = (sw - sw * z) * s(), oy = (sh - sh * z) * s();
        const fx = s() < 0.5 ? -1 : 1, fy = s() < 0.5 ? -1 : 1;

        g.save();
        g.scale(fx, fy);
        g.drawImage(img, sx + ox, sy + oy, sw * z, sh * z, -box / 2, -box / 2, box, box);
        g.restore();
    }

    /* detail says how large the section is about to be shown, which picks the
       tissue atlas and, on the fallback path, how fine to draw the stain.

       The canvas passed in is the section's own, and nothing else is ever drawn
       on it, so compositing the tissue straight into the mask is safe. */
    function drawSection(g, cells, R, rScale, slide, detail, gray) {
        const d = detail || 1;
        /* Every section is cut, stained and imaged separately, so no two come
           out the same colour or the same density even before the biology
           differs. Without this the grid is twenty copies of one picture, and
           the beat it has to carry is that they are all different. */
        const s = rng(slide);
        const hue = [(s() - 0.5) * 26, (s() - 0.5) * 12, (s() - 0.5) * 20];
        const density = 0.62 + s() * 0.85;
        const grain = 0.86 + s() * 0.34;

        if (HE.grid && (!gray || HE.gridGray)) {
            const box = R * 3.1;
            cutMask(g, cells, R, rScale, d);
            g.globalCompositeOperation = 'source-in';
            drawStain(g, R, s, box, d > 1, gray);
            // the cast of the slide, which is a batch of reagent and a scanner
            // as much as it is the tissue
            g.globalCompositeOperation = 'source-atop';
            g.fillStyle = gray
                ? `rgba(235,235,235,${0.05 + s() * 0.1})`
                : `rgba(${186 + hue[0] | 0},${96 + hue[1] | 0},${140 + hue[2] | 0},${0.05 + s() * 0.1})`;
            g.fillRect(-box / 2, -box / 2, box, box);
            g.globalCompositeOperation = 'source-over';
            return;
        }

        /* No tissue to cut, so it is drawn instead: a disc per cell for the
           eosin and a scatter of nuclei for the hematoxylin. */
        for (const c of cells) {
            // wider than the cell, so neighbouring discs union into a sheet
            // rather than a bunch of grapes, but not so wide that a section
            // outgrows the cluster it replaces and the grid starts to crowd
            const x = c.px * R, y = c.py * R, r = c.pr * R * rScale * (1.9 + (d - 1) * 0.16);
            const k = hash(x * 0.31 + y * 0.77);
            const tone = `${EOSIN[0] + hue[0] + k * 30 | 0},${EOSIN[1] + hue[1] + k * 22 | 0},${EOSIN[2] + hue[2] + k * 18 | 0}`;
            /* Softened by fading each disc over its outer edge rather than by
               blurring the result. A canvas filter here is a blurred fill per
               cell, which is tens of them per section and a section per
               patient, and it costs more than the rest of the page together. */
            const grd = g.createRadialGradient(x, y, r * 0.86, x, y, r);
            grd.addColorStop(0, `rgb(${tone})`);
            grd.addColorStop(1, `rgba(${tone},0)`);
            g.beginPath();
            g.arc(x, y, r, 0, TAU);
            g.fillStyle = grd;
            g.fill();
        }

        /* Several nuclei per cell rather than one. A layout carries about a
           hundred cells, and a hundred evenly spaced dots reads as a pattern
           and not as tissue; the density has to be high enough, and irregular
           enough, that the eye stops counting and starts seeing a section. */
        for (const c of cells) {
            const x = c.px * R, y = c.py * R;
            const r = c.pr * R * rScale;
            const seed = c.px * 131.7 + c.py * 57.3;
            const tint = c.m * 0.34;
            const base = [
                chan(HEMA, c.pal.deep, tint, 0),
                chan(HEMA, c.pal.deep, tint, 1),
                chan(HEMA, c.pal.deep, tint, 2)
            ];
            const n = Math.max(1, Math.round((4 + hash(seed) * 4) * density * d * d));
            // more of them, each proportionally smaller, so the density on the
            // page stays put as the section is drawn bigger
            const fine = grain / d;

            for (let i = 0; i < n; i++) {
                const k1 = hash(seed + i * 3.31);
                const k2 = hash(seed + i * 7.79 + 1.7);
                const k3 = hash(seed + i * 11.13 + 4.2);
                // square-rooted, so nuclei spread evenly over the area they
                // occupy instead of bunching at the centre of every cell
                const a = k1 * TAU, d = Math.sqrt(k2) * r * 1.35;
                const nr = r * (0.17 + k3 * 0.15) * fine;
                const lift = k3 * 30 | 0;
                g.save();
                g.translate(x + Math.cos(a) * d, y + Math.sin(a) * d);
                g.rotate(k1 * TAU);
                g.beginPath();
                g.ellipse(0, 0, nr * (0.66 + k2 * 0.44), nr, 0, 0, TAU);
                g.fillStyle = `rgb(${base[0] + lift},${base[1] + (lift * 0.7 | 0)},${base[2] + lift})`;
                g.fill();
                g.restore();
            }
        }
    }

    /* Grid of slots for the cohort, kept clear of the caption column and
       progress rail. */
    function initCohort() {
        const x0 = fx + fw * (wide ? 0.375 : 0.05);
        const x1 = fx + fw * (wide ? 0.93 : 0.95);
        const y0 = wide ? H * 0.10 : H * 0.05;
        const y1 = wide ? H * 0.89 : H * 0.58;
        const rw = x1 - x0, rh = y1 - y0;

        const cols = rw > 900 ? 6 : rw > 620 ? 5 : rw > 420 ? 4 : 3;
        const cellW = rw / cols;
        const rows = Math.max(2, Math.min(4, Math.floor(rh / cellW)));
        const cellH = rh / rows;

        const slots = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const jr = hash(r * 31.7 + c * 7.13);
                const x = x0 + cellW * (c + 0.5) + (jr - 0.5) * cellW * 0.12;
                const y = y0 + cellH * (r + 0.5) + (hash(r * 5.3 + c * 19.1) - 0.5) * cellH * 0.12;
                slots.push({ x, y, slotR: Math.min(cellW, cellH) * 0.42 * (0.86 + jr * 0.26) });
            }
        }

        // the tumor from phase 1 keeps the slot nearest where it already sits
        let pick = 0, best = Infinity;
        slots.forEach((s, i) => {
            const d = Math.hypot(s.x - cx, s.y - cy);
            if (d < best) { best = d; pick = i; }
        });
        const first = slots.splice(pick, 1)[0];

        const tumors = [{ x: first.x, y: first.y, slotR: first.slotR, layout: null, order: 0 }];
        slots.forEach((s, i) => {
            tumors.push({
                x: s.x, y: s.y, slotR: s.slotR,
                layout: null, sprite: null,
                order: Math.hypot(s.x - first.x, s.y - first.y)
            });
        });

        const rest = tumors.slice(1).sort((a, b) => a.order - b.order);
        // order01 is how far down the queue a patient is, which the second
        // stage staggers the pipeline by. The followed tumor goes first.
        rest.forEach((t, i) => {
            t.rank = i;
            t.order01 = rest.length > 1 ? (i + 1) / rest.length : 1;
        });
        tumors[0].order01 = 0;

        // the handful the last beat picks out: the patient we followed, plus a few
        // others, kept apart so no two selection rings ever collide
        const shortlist = [tumors[0]];
        const want = Math.max(3, Math.round(tumors.length * 0.22));
        const candidates = rest.slice().sort((a, b) => hash(a.rank * 12.9 + 3.1) - hash(b.rank * 12.9 + 3.1));
        for (const t of candidates) {
            if (shortlist.length >= want) break;
            const clear = shortlist.every(o => Math.hypot(o.x - t.x, o.y - t.y) > (o.slotR + t.slotR) * 1.4);
            if (clear) shortlist.push(t);
        }
        shortlist.forEach(t => { t.chosen = true; });
        tumors[0].pid = 1020 + Math.floor(hash(11.7) * 8600);

        cohort = {
            tumors,
            queue: rest.slice(),
            // filled by the second stage, which needs the same tumors stained
            sections: rest.slice(),
            // sections whose washed copy is still owed, because the grey tissue
            // had not arrived when the colour one was baked
            drains: [],
            // the second stage pulls the whole grid back about its own middle,
            // so it has to know where that is
            mid: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
            total: tumors.length
        };
    }

    /* Sprites are built a couple per frame so the zoom-out never stutters.

       One bake each, on paper. The cohort closes the cell stage and the same
       tumors open the engine stage, and both of those sit on paper now, so the
       occlusion and falloff baked into a sprite are right wherever it is used. */
    function growSprites(budget) {
        for (let n = 0; n < budget && cohort.queue.length; n++) {
            const t = cohort.queue.shift();
            if (!t.layout) t.layout = buildLayout(t.rank * 7 + 13);
            const R = t.slotR * 1.7;
            const size = Math.max(8, Math.ceil(R * 2 * dpr));
            const was = ground;
            ground = GROUNDS.paper;
            const cv = document.createElement('canvas');
            cv.width = cv.height = size;
            const g = cv.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.translate(R, R);
            dctx = g;
            pxScale = dpr;
            const aura = auraTint(t.layout.cells);
            drawAura(t.slotR, aura.tint, 0.22);
            drawLayout(t.layout, t.slotR);
            pxScale = dpr;
            dctx = ctx;
            t.sprite = cv;
            ground = was;
            t.spriteR = R;
        }
    }

    function label(g, text, x, y, alpha, accent, size) {
        g.font = `500 ${size || 9}px Inter, system-ui, sans-serif`;
        g.textAlign = 'center';
        g.fillStyle = `rgba(${accent ? ground.inkAccent : ground.ink},${alpha})`;
        g.fillText(text, x, y);
    }

    const noteSize = () => Math.max(10, Math.round(minDim * 0.0135));

    /* Where the names already on the figure ended up, so the next one can be put
       somewhere else. Cleared once per drawing of the figure. */
    const noteBoxes = [];

    function noteFree(x, y, w, h) {
        return !noteBoxes.some(b => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y);
    }

    // how finely the mass is entered as taken, per side
    const MASK = 5;

    /* The drawing itself, entered as taken before any name is placed. Without it
       the placement only knows about the other names and will happily set one over
       the cells, which on a narrow screen is where its heading points.

       Entered as a grid of squares rather than as one rectangle around the whole
       mass. The mass is a blob in a rectangle that is a third corner by area, and
       those corners are exactly where a name wants to sit: diagonally out from the
       middle, near the thing it names. One rectangle gives them all away. */
    function occupy(cells, ox, oy, k) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const c of cells) {
            const r = c.pr * SPAN;
            if (c.px - r < x0) x0 = c.px - r;
            if (c.py - r < y0) y0 = c.py - r;
            if (c.px + r > x1) x1 = c.px + r;
            if (c.py + r > y1) y1 = c.py + r;
        }
        if (x0 > x1) return;

        const sw = (x1 - x0) / MASK, sh = (y1 - y0) / MASK;
        const hit = new Uint8Array(MASK * MASK);
        for (const c of cells) {
            const r = c.pr * SPAN;
            const i0 = Math.max(0, Math.floor((c.px - r - x0) / sw));
            const i1 = Math.min(MASK - 1, Math.floor((c.px + r - x0) / sw));
            const j0 = Math.max(0, Math.floor((c.py - r - y0) / sh));
            const j1 = Math.min(MASK - 1, Math.floor((c.py + r - y0) / sh));
            for (let j = j0; j <= j1; j++) {
                for (let i = i0; i <= i1; i++) hit[j * MASK + i] = 1;
            }
        }

        for (let j = 0; j < MASK; j++) {
            for (let i = 0; i < MASK; i++) {
                if (!hit[j * MASK + i]) continue;
                noteBoxes.push({
                    x: ox + (x0 + i * sw) * k, y: oy + (y0 + j * sh) * k,
                    w: sw * k, h: sh * k
                });
            }
        }
    }

    /* A name attached to a part of the drawing, in three pieces: a dot on the one
       cell being named, a leader off that cell, and a shelf the name sits on top
       of.

       The name used to hang off the far end of the leader, level with it, which
       asks the reader to work out which end of a diagonal line is the claim and
       which is the label. Set on a shelf the line reads as the name's own
       underline, and the only loose end left is the one touching the cell.

       The leader runs into the named cell and stops on the dot at its centre,
       rather than out at the edge of the mass or short of the cell's rim. Ending
       it on the silhouette leaves a gap between the line and the dot, and the
       reader is back to judging which cell a line that stops nearby is for.

       Which of the cells it could point at is settled after the name is placed,
       not before: the shortest leader is the one that crosses the least, and until
       the name has a place there is no telling which cell that is.

       args:
           text (str): the name
           pts (list): the cells the name may point at, [{x, y}] in canvas pixels,
               the one furthest out along the heading first
           dx, dy (number): unit heading the leader runs out along
           lead (number): how far out the elbow sits before the shelf
           size (number): type size, which every other measure here is taken from */
    // headings tried either side of the one a name is given, in radians
    const NOTE_TURNS = [0, 0.44, -0.44, 0.92, -0.92, 1.5, -1.5];

    function drawNote(text, pts, dx, dy, lead, size) {
        const ax = pts[0].x, ay = pts[0].y;

        ctx.font = `500 ${size}px Inter, system-ui, sans-serif`;
        // a shelf a little longer than its name, so the name sits on a line rather
        // than on a rule cut to exactly its own width
        const shelf = ctx.measureText(text).width + size * 0.7;
        /* Held off the sides, because the box is not all the room there is: the
           rail and the way out sit just outside it, and a name run up to the edge
           reads as part of them. */
        const edge = size * 1.2;
        const rise = size * 0.52;
        const box = size * 1.75 + rise;
        const x0 = fx + edge, x1 = fx + fw - edge - shelf;

        /* The nearest clear paper, looked for by stepping out along the heading and
           by swinging either side of it. A heading alone is not enough: it is read
           off where the thing being named sits in the mass, and on a narrow screen
           the paper is not in that direction at all, so a name given only its own
           heading walks out along it into the cells or off the frame. Sweeping the
           distance first and the angle second keeps a name as close to its subject
           as it can be while still landing somewhere legible. */
        const spot = (turn, out) => {
            const c = Math.cos(turn), s = Math.sin(turn);
            const hx = ax + (dx * c - dy * s) * out;
            const hy = ay + (dx * s + dy * c) * out;
            return {
                // the shelf leaves the elbow on whichever side of it has the paper
                x: clamp(hx + shelf <= x1 ? hx : hx - shelf, x0, Math.max(x0, x1)),
                y: clamp(hy, box, H - box * 0.35)
            };
        };

        /* Failing everything, as far out along its own heading as the search was
           willing to go. Anywhere is better than the fallback being the anchor,
           which is the one place on the figure guaranteed to have a cell under it:
           where nothing is free, the name would be set on top of its own subject. */
        let at = spot(0, lead * 3);
        for (let i = 0; i < 6; i++) {
            const out = lead * (1 + i * 0.40);
            const found = NOTE_TURNS.map(t => spot(t, out)).find(c => noteFree(c.x, c.y - box, shelf, box));
            if (found) { at = found; break; }
        }
        const sx = at.x, sy = at.y;
        noteBoxes.push({ x: sx, y: sy - box, w: shelf, h: box });

        // the elbow is whichever end of the shelf the subject is on the side of
        const ex = Math.abs(ax - sx) <= Math.abs(ax - (sx + shelf)) ? sx : sx + shelf;
        let tip = pts[0], near = Infinity;
        for (const c of pts) {
            const d = Math.hypot(c.x - ex, c.y - sy);
            if (d < near) { near = d; tip = c; }
        }

        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${ground.ink},0.38)`;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(ex, sy);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + shelf, sy);
        ctx.stroke();

        // the dot is the whole claim: this cell, not the neighbourhood of it
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, Math.max(1.6, size * 0.17), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ground.ink},0.62)`;
        ctx.fill();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = `rgba(${ground.ink},0.78)`;
        ctx.fillText(text, sx + size * 0.35, sy - rise);
        ctx.textAlign = 'center';
    }

    /* What the figure is of, named part by part.

       It is a figure now rather than something the reader watches assemble, so
       every name is up the whole time it is on screen and the set has to be
       complete. Colour alone cannot tell a subclone from the clone it came out
       of, or either of those from a clone that arose on its own, and those are
       exactly the distinctions the caption is making: a tumor that is several
       diseases at once and still changing. Unnamed, it is an attractive blob.

       Named at every width. They used to be wide-screen only, on the reasoning
       that a phone has no margin to label into; what that came to in practice was
       that the reader who cannot see the labels is handed the attractive blob and
       the reader who can is handed the argument. The room is made instead, by
       drawing the mass smaller where the labels have to share the width with it. */
    const FIGURE_NOTES = [
        { text: 'normal tissue', pick: c => c.m <= 0.15 },
        { text: 'a clone, from one mutation', pick: c => c.pal0 === PALETTES.primary && c.m > 0.15 && c.m2 <= 0.15 },
        { text: 'subclones diverging from it', pick: c => c.m2 > 0.15 },
        { text: 'a second, independent clone', pick: c => c.pal0 === PALETTES.second && c.m > 0.15 }
    ];

    const noteLead = () => Math.min(54, Math.max(22, minDim * 0.055));

    function annotateClones(cells, k) {
        const lead = noteLead();
        const size = noteSize();
        const cyy = figCy();

        /* Read off the projected positions, not the modelled ones. The mass is
           drawn in perspective, so a cell's place on the paper is its own position
           divided down by its depth, and a dot put at the modelled position lands
           beside the cell it is naming rather than on it. */
        for (const note of FIGURE_NOTES) {
            let sx = 0, sy = 0, n = 0;
            for (const c of cells) {
                if (!note.pick(c)) continue;
                sx += c.px; sy += c.py; n++;
            }
            if (!n) continue;

            let dx = sx / n, dy = sy / n;
            const d = Math.hypot(dx, dy);
            // a structure sitting on the middle of the mass has no side of its
            // own, so it is given one rather than dividing by nothing
            if (d < 0.001) { dx = 0.86; dy = -0.51; } else { dx /= d; dy /= d; }

            /* Every cell the name is true of and can be seen, on paper and sorted
               outward along the heading. The leader has to end on a cell that
               actually is what the name says; which one is settled once the name
               has a place. */
            const shown = cells.filter(c => note.pick(c) && c.bare);
            const pts = (shown.length ? shown : cells.filter(note.pick))
                .map(c => ({ x: cx + c.px * k, y: cyy + c.py * k, along: c.px * dx + c.py * dy }))
                .sort((a, b) => b.along - a.along);
            const far = pts[0].along;

            /* How far the mass reaches along that heading, rather than how far its
               bounding circle does: the cluster is nowhere near round. The named
               cell can be well inside that reach even while being the outermost of
               its own kind, and an elbow set a fixed distance from the cell then
               puts the name down on top of the cells in front of it. */
            let ext = 0;
            for (const c of cells) {
                const along = c.px * dx + c.py * dy + c.pr;
                if (along > ext) ext = along;
            }
            const clear = Math.max(0, ext - far) * k;

            drawNote(note.text, pts, dx, dy, clear + lead, size);
        }
    }

    /* A patient the page has singled out: a ring drawn around the tumor and a
       little light underneath it, so the choice reads as made rather than
       announced. Used for the shortlist at the end of the cell stage and again
       for a predicted responder in the last one, which is the same act. */
    function drawRing(g, x, y, r, strength) {
        // light behind the choice only works where there is darkness to lift; on
        // paper the ring carries the whole emphasis on its own
        if (ground.halo) {
            const glow = g.createRadialGradient(x, y, r * 0.2, x, y, r * 1.5);
            glow.addColorStop(0, `rgba(127,180,255,${0.16 * strength * ground.halo})`);
            glow.addColorStop(1, 'rgba(127,180,255,0)');
            g.beginPath();
            g.arc(x, y, r * 1.5, 0, TAU);
            g.fillStyle = glow;
            g.fill();
        }

        g.save();
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.lineWidth = 1.1;
        g.strokeStyle = `rgba(${ground.ring},${ground.ringAlpha * strength})`;
        if (ground.halo) {
            g.shadowColor = `rgba(127,180,255,${0.5 * strength})`;
            g.shadowBlur = 12;
        }
        g.stroke();
        g.restore();
    }

    function renderCohort(q) {
        if (!cohort) initCohort();
        growSprites(3);
        // the second stage wants every one of these stained, and it is the very
        // next thing down the page, so the tissue is fetched and the cutting
        // started here rather than costing the opening a download it cannot use
        loadStains();
        growSections(1);

        const built = fullyGrown();
        const bound = boundsRadius(built.cells);
        const aura = auraTint(built.cells);
        const home = cohort.tumors[0];
        const e = smooth(clamp01(q / 0.5));
        /* Started at exactly where the figure left it, in both size and place. Any
           other number is a jump at the seam: the same tumor is on the screen
           either side of it, and this act's whole move is the camera pulling back
           off it. Off by a tenth, which is what a hardcoded fraction of the box
           came to, it popped instead. */
        const shown = lerp(figR, home.slotR, e);

        const hx = lerp(cx, home.x, e), hy = lerp(figCy(), home.y, e);
        const k = shown / bound;
        ctx.save();
        ctx.translate(hx, hy);
        ctx.scale(k, k);
        pxScale = k * dpr;
        drawAura(bound, aura.tint, 0.16 + aura.avgM * 0.1);
        drawCluster(built.cells);
        pxScale = dpr;
        ctx.restore();

        // once the grid is full, the ones that were picked stay lit and the rest
        // fall back: the shortlist a trial would actually enrol
        const sel = smooth(clamp01((q - 0.76) / 0.19));

        for (let i = 1; i < cohort.tumors.length; i++) {
            const t = cohort.tumors[i];
            if (!t.sprite) continue;
            // the grid has to be full by the time the count is quoted, not
            // still filling, so the beat lands on a cohort and not on a corner
            const appear = clamp01((q - 0.20 - (t.rank / cohort.total) * 0.24) / 0.10);
            if (appear <= 0) continue;
            const held = t.chosen ? 1 : lerp(1, 0.2, sel);
            const sc = (0.72 + 0.28 * appear) * (t.chosen ? 1 + 0.04 * sel : 1 - 0.04 * sel);
            const w = t.spriteR * 2 * sc;
            ctx.globalAlpha = appear * held;
            ctx.drawImage(t.sprite, t.x - w / 2, t.y - w / 2, w, w);
            ctx.globalAlpha = 1;
            if (appear > 0.55 && wide) {
                const lit = (appear - 0.55) * 0.62;
                label(ctx, 'PT-' + t.layout.id, t.x, t.y + t.slotR * 1.5,
                    t.chosen ? lit + 0.5 * sel : lit * held, t.chosen && sel > 0.2);
            }
        }

        if (wide && e > 0.62) {
            const lit = Math.min((e - 0.62) * 2.6, 1);
            label(ctx, 'PT-' + home.pid, home.x, home.y + home.slotR * 1.5, lit * (0.28 + 0.5 * sel), sel > 0.2);
        }

        if (sel > 0.01) {
            for (const t of cohort.tumors) {
                if (t.chosen && (t === home || t.sprite)) {
                    drawRing(ctx, t.x, t.y, t.slotR * 1.24, sel);
                }
            }
        }
    }

    /* ---------- the trials act ----------

       Both exhibits redrawn whole: the headline panel and the four breakdowns
       beside it, every series, in the source's own colours. They are laid over
       the cohort rather than in place of it, so the tissue the argument is
       about never leaves the screen, and each is swept out left to right under
       the scroll the way everything else in this stage is drawn.

       Neither exhibit prints its data points, so these are read off the plots.
       The shapes are the claim, and the numbers worth stating outright are in
       the caption beside them. */

    // phase 1, phase 3, and the stack between them, in the exhibits' own colours
    const PHASES = ['77,163,216', '21,63,110', '58,166,74'];

    /* Trial starts 2015 to 2024, as phase 1, the cumulative total through phase
       2, and the total: three lines each filled to the axis and drawn top-down
       stack the bands without any of them having to be a band.

       The headline series only. The exhibit breaks oncology into four sub-groups
       beside it, and all four are the same shape as the total by construction, so
       four extra panels on the beat that says the field is testing plenty of drugs
       were four ways of saying the thing the big panel already said. */
    const STARTS = {
        name: 'ONCOLOGY',
        v: [[370, 450, 510, 545, 575, 620, 760, 730, 690, 680],
            [990, 1180, 1330, 1390, 1425, 1450, 1770, 1680, 1580, 1550],
            [1130, 1310, 1480, 1530, 1570, 1630, 1960, 1860, 1750, 1780]]
    };

    /* The one series the second exhibit's panels carry.

       The exhibit runs five: oncology and the same four sub-groups. They sit
       within a few points of each other the whole way, so the second beat was five
       panels of five near-identical lines, and the claim it is making is about the
       rate itself rather than about which sub-group is worst. */
    const SERIES = [{ name: 'ONCOLOGY', c: '63,150,207' }];

    /* Success rate at each of the three clinical phases, 2019 to 2024. The
       exhibit carries the regulatory step and the composite of all four beside
       these; the regulatory step is at or near 100 the whole way, which is a
       rubber stamp rather than a trial reading out, and the composite is the
       caption's own sentence drawn a fourth time. */
    const RATES = [
        { name: 'PHASE 1', span: 100, at: [0, 20, 40, 60, 80, 100], v: [[38, 47, 50, 47, 42, 48]] },
        { name: 'PHASE 2', span: 100, at: [0, 20, 40, 60, 80, 100], v: [[23, 27, 27, 24, 21, 18]] },
        { name: 'PHASE 3', span: 100, at: [0, 20, 40, 60, 80, 100], v: [[65, 55, 45, 50, 47, 68]] }
    ];

    /* The room a chart gets: the canvas between the caption column and the
       progress rail on a wide screen, and all of it on a narrow one, where the
       captions sit under the canvas instead of beside it.

       Taken against the frame, or the chart is the one thing on an ultrawide
       screen still stretching after everything around it has stopped: two thousand
       pixels of plot with 10px axis labels on it, a thousand clear of the caption
       it is being read against. */
    function chartBox() {
        if (wide) return { x0: fx + fw * 0.34, x1: fx + fw * 0.935, y0: H * 0.11, y1: H * 0.88 };
        return { x0: fx + fw * 0.07, x1: fx + fw * 0.95, y0: chartTop, y1: chartFloor };
    }

    function sweepClip(g, x0, x1, y0, y1, sweep) {
        g.beginPath();
        g.rect(x0 - 2, y0 - 60, (x1 - x0) * sweep + 2, (y1 - y0) + 120);
        g.clip();
    }

    /* How many chips fit across, taken from the widest name in the set rather than
       from a fixed five: the second exhibit's five series carry names up to
       HAEMATOLOGICAL, and five columns of a phone's width is 56px each, so they
       were printed through one another. */
    function chipWidth(items, size, bar) {
        ctx.font = `500 ${size}px Inter, system-ui, sans-serif`;
        let need = 0;
        for (const it of items) need = Math.max(need, ctx.measureText(it.name).width);
        return need + (bar ? 20 : 15) + 14;
    }

    function legendCols(items, width, size, bar) {
        return Math.max(1, Math.min(items.length, Math.floor(width / chipWidth(items, size, bar))));
    }

    // the room a legend and the source line under it need, so the panels above
    // them can be given what is left rather than a fixed allowance
    function footFor(items, width, size, bar) {
        const rows = Math.ceil(items.length / legendCols(items, width, size, bar));
        return 26 + rows * (size + 8) + size + 7;
    }

    /* A row of colour chips and their names, wrapped to whatever fits. Returns
       the height it used so the source line underneath knows where to sit. */
    function legend(items, x, y, width, size, bar) {
        const cols = legendCols(items, width, size, bar);
        // a column is as wide as the widest chip, not as wide as its share of the
        // box, so three keys under a full-width panel stay one group instead of
        // being dealt across two feet of paper
        const colw = Math.min(width / cols, chipWidth(items, size, bar));
        let row = 0;
        items.forEach((it, i) => {
            const col = i % cols;
            row = Math.floor(i / cols);
            const px = x + col * colw;
            const py = y + row * (size + 8);
            ctx.fillStyle = `rgb(${it.c})`;
            if (bar) ctx.fillRect(px, py - size * 0.5, 14, 2.4);
            else ctx.fillRect(px, py - size * 0.8, 9, 9);
            vtext(ctx, it.name, px + (bar ? 20 : 15), py, 0.62, false, size, 'left');
        });
        return (row + 1) * (size + 8);
    }

    /* How many of a panel's gridlines get a number on them. Every one of them, if
       there is a line's worth of room between them; every other one, if there is
       half; and otherwise the two ends and nothing between.

       A panel is as tall as the box it is in divides down to, and on a landscape
       phone that came to forty pixels for six labels: the exhibits' own scale
       printed as a single grey smudge where the axis should be. An unlabelled
       gridline still carries its interval, so the ones that come off lose the
       reader nothing they cannot get from the two that stay. */
    function labelEvery(span, count, size) {
        const gap = span / (count - 1);
        if (gap >= size * 1.5) return 1;
        if (gap * 2 >= size * 1.5) return 2;
        return count - 1;
    }

    /* A size the text will fit the given width at, down to a floor, so a panel
       name never runs past the panel it belongs to. */
    function fitSize(text, width, size) {
        ctx.font = `500 ${size}px Inter, system-ui, sans-serif`;
        const w = ctx.measureText(text).width;
        return w <= width ? size : Math.max(size * 0.74, size * (width / w));
    }

    /* One stacked-area panel. The three series are filled from their own line
       down to the axis, drawn from the top of the stack down, so each covers
       the tail of the one behind it and no band has to be computed. */
    function areaPanel(s, x, y, w, h, sweep) {
        const size = 10;
        const ax = x + 44;
        // room for the panel's name above and its years below, given up in
        // proportion on a panel too short to spare it outright
        const ay0 = y + Math.min(22, h * 0.2);
        const ay1 = y + h - Math.min(22, h * 0.22);
        const xAt = i => ax + (x + w - ax) * (i / 9);
        const yAt = v => ay1 - (v / 2500) * (ay1 - ay0);

        vtext(ctx, s.name, x, y + 8, 0.78, false, fitSize(s.name, w, size), 'left');

        const marks = [0, 500, 1000, 1500, 2000, 2500];
        const every = labelEvery(ay1 - ay0, marks.length, size - 1);

        ctx.strokeStyle = `rgba(${ground.ink},0.12)`;
        ctx.lineWidth = 1;
        marks.forEach((v, i) => {
            const gy = yAt(v);
            ctx.beginPath();
            ctx.moveTo(ax, gy);
            ctx.lineTo(x + w, gy);
            ctx.stroke();
            if (i % every === 0) vtext(ctx, v.toLocaleString('en-US'), ax - 6, gy + 3, 0.45, false, size - 1, 'right');
        });

        ctx.save();
        sweepClip(ctx, ax, x + w, ay0, ay1, sweep);
        for (let k = 2; k >= 0; k--) {
            ctx.beginPath();
            ctx.moveTo(xAt(0), yAt(s.v[k][0]));
            for (let i = 1; i < 10; i++) ctx.lineTo(xAt(i), yAt(s.v[k][i]));
            ctx.lineTo(xAt(9), ay1);
            ctx.lineTo(xAt(0), ay1);
            ctx.closePath();
            ctx.fillStyle = `rgb(${PHASES[k]})`;
            ctx.fill();
        }
        ctx.restore();

        const foot = Math.min(16, h * 0.16);
        vtext(ctx, '2015', ax, ay1 + foot, 0.45, false, size - 1, 'left');
        vtext(ctx, '2024', x + w, ay1 + foot, 0.45, false, size - 1, 'right');
    }

    /* Whether the room a chart has is wide enough against its own height to take
       the exhibits' side-by-side arrangement.

       The stylesheet breaks on width alone, and a landscape phone is narrow by
       that reckoning while having twice the width it needs: the stacked layout put
       five panels in two columns and three rows inside a box 743 by 172, which is
       forty pixels of plot each, in a box that lays the same five out in one row
       at four times the height. So the arrangement is chosen from the shape of the
       room rather than from the screen it is on. */
    function chartWide(b) {
        return wide || (b.x1 - b.x0) > (b.y1 - b.y0) * 2.2;
    }

    function drawStarts(alpha, sweep) {
        const b = chartBox();
        const side = chartWide(b);
        const size = side ? 10 : 9;
        const keys = ['PHASE 1', 'PHASE 2', 'PHASE 3'].map((name, i) => ({ name: name, c: PHASES[i] }));
        const w = b.x1 - b.x0;
        const foot = footFor(keys, w, size, false);

        ctx.save();
        ctx.globalAlpha = alpha;

        // the one panel takes the whole box now that the four breakdowns beside it
        // are gone, so the shape the beat is about is read at full size
        areaPanel(STARTS, b.x0, b.y0, w, (b.y1 - foot) - b.y0, sweep);

        const used = legend(keys, b.x0, b.y1 - foot + 24, w, size, false);
        vtext(ctx, 'IQVIA GLOBAL ONCOLOGY TRENDS 2025 \u00b7 EXHIBIT 1',
            b.x0, b.y1 - foot + 26 + used, 0.4, false, size - 1, 'left');

        ctx.restore();
    }

    function drawRates(alpha, sweep) {
        const b = chartBox();
        const side = chartWide(b);
        // one row where there is the width for it, one column where there is not:
        // three panels split two and one leaves a hole the reader has to account
        // for, and half a phone is a thumbnail rather than a chart
        const cols = side ? RATES.length : 1;
        const rows = Math.ceil(RATES.length / cols);
        const size = side ? 10 : 9;
        const foot = footFor(SERIES, b.x1 - b.x0, size, true);
        const gx = (b.x1 - b.x0) * (side ? 0.03 : 0.10);
        const h = (b.y1 - foot) - b.y0;
        const gy = h * (rows > 1 ? 0.10 : 0);
        const pw = ((b.x1 - b.x0) - gx * (cols - 1)) / cols;
        const ph = (h - gy * (rows - 1)) / rows;

        ctx.save();
        ctx.globalAlpha = alpha;

        RATES.forEach((r, i) => {
            const x = b.x0 + (i % cols) * (pw + gx);
            const y = b.y0 + Math.floor(i / cols) * (ph + gy);
            const ax = x + 30;
            const ay0 = y + Math.min(22, ph * 0.2);
            const ay1 = y + ph - Math.min(24, ph * 0.22);
            const xAt = j => ax + (x + pw - ax) * (j / 5);
            const yAt = v => ay1 - (v / r.span) * (ay1 - ay0);

            vtext(ctx, r.name, x, y + 7, 0.72, false, size, 'left');

            const every = labelEvery(ay1 - ay0, r.at.length, size - 1);

            ctx.strokeStyle = `rgba(${ground.ink},0.12)`;
            ctx.lineWidth = 1;
            r.at.forEach((v, j) => {
                const py = yAt(v);
                ctx.beginPath();
                ctx.moveTo(ax, py);
                ctx.lineTo(x + pw, py);
                ctx.stroke();
                if (j % every === 0) vtext(ctx, v + (v ? '%' : ''), ax - 6, py + 3, 0.45, false, size - 1, 'right');
            });

            ctx.save();
            sweepClip(ctx, ax, x + pw, ay0, ay1, sweep);
            ctx.lineWidth = 1.7;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            // drawn back to front, so the headline series finishes on top of the
            // four it is the aggregate of
            for (let k = SERIES.length - 1; k >= 0; k--) {
                ctx.beginPath();
                ctx.moveTo(xAt(0), yAt(r.v[k][0]));
                for (let j = 1; j < 6; j++) ctx.lineTo(xAt(j), yAt(r.v[k][j]));
                ctx.strokeStyle = `rgb(${SERIES[k].c})`;
                ctx.stroke();
            }
            ctx.restore();

            const base = ay1 + Math.min(16, ph * 0.16);
            vtext(ctx, '2019', ax, base, 0.45, false, size - 1, 'left');
            vtext(ctx, '2024', x + pw, base, 0.45, false, size - 1, 'right');
        });

        const used = legend(SERIES, b.x0, b.y1 - foot + 26, b.x1 - b.x0, size, true);
        vtext(ctx, 'IQVIA GLOBAL ONCOLOGY TRENDS 2025 \u00b7 EXHIBIT 19',
            b.x0, b.y1 - foot + 28 + used, 0.4, false, size - 1, 'left');

        ctx.restore();
    }

    /* Two charts, one act, and the difference matters. The wash they sit on is
       its own envelope, held flat across both charts and the handover between
       them and lifted once at the end. Tying it to whichever chart was showing
       is what put the picture underneath back on screen in the gap between them,
       where it is nothing to do with either.

       It opens at full rather than fading in, because the act starts at the top
       of the stage and there is nothing to fade in from: the single cell waiting
       under it is the one the biology opens on, and a wash that ramps up shows it
       for a moment first. Lifting it at the end is that cell's entrance.

       Each chart draws quickly and then holds, because a chart is read while it
       is still rather than while it is arriving. The hold is the long part of
       both windows and is what the beat is actually for. */
    function renderTrials(prog) {
        const t = clamp01(prog / BIO_A);

        const wash = 1 - clamp01((t - 0.93) / 0.07);
        if (wash <= 0.004) return;

        // opaque, not nearly so. It is the page's own paper to the byte and the
        // grain sits above the canvas, so covering the cell completely costs
        // nothing and leaving it at 0.985 put a ghost of it behind the panels
        ctx.fillStyle = `rgba(247,248,251,${wash})`;
        ctx.fillRect(0, 0, W, H);

        /* One leaves exactly as the other arrives, and both are pinned to where
           the caption beside them changes: a chart at half strength under a
           heading that is still at full is the same mistake as the grid showing
           through, one layer up. */
        const a1 = clamp01((t - 0.07) / 0.07) * (1 - clamp01((t - 0.51) / 0.05));
        const a2 = clamp01((t - 0.56) / 0.06) * (1 - clamp01((t - 0.87) / 0.06));

        if (a1 > 0.004) drawStarts(a1, smooth(clamp01((t - 0.08) / 0.16)));
        if (a2 > 0.004) drawRates(a2, smooth(clamp01((t - 0.57) / 0.15)));
    }

    /* The grid fills, then picks its shortlist out. It no longer has to hold
       partway while the charts pass over it, because they have gone by the time
       it starts building. */
    function cohortQ(prog) {
        if (prog <= COHORT_FULL) return clamp01((prog - META_END) / (COHORT_FULL - META_END)) * 0.76;
        return 0.76 + clamp01((prog - COHORT_FULL) / (1 - COHORT_FULL)) * 0.24;
    }

    /* ---------- second stage: what we do with them ---------- */

    /* The same grid of patients, run through the operation. Same slots, same
       tumors, and nothing moves between beats: each one is the same twenty
       patients seen a step further along. That is the only way the last beat
       (a new tumor placed against the ones already measured) reads as being
       about these tumors rather than about a new picture.

       It borrows the first stage's grid, layouts and sprite cache wholesale.
       Both canvases are the same sticky 100vh box, so a slot is in the same
       place on each and a tumor can be handed straight across. */
    const estage = document.getElementById('engineStage');
    const ecanvas = document.getElementById('engineCanvas');
    const ectx = ecanvas ? ecanvas.getContext('2d') : null;
    const erail = document.getElementById('engineRail');
    const engineBeat = document.getElementById('engineBeat');
    const ecaptions = Array.from(document.querySelectorAll('#engineCaptions .caption'));

    let ep = 0;
    let epTarget = 0;
    // engine-local progress. The stage carries two acts now, and this is the
    // first one's own 0..1 so that its beats did not have to be renumbered when
    // the closing act was folded in behind them
    let eq = 0;
    let query = null;

    /* How much of the stage the engine act gets. Past this the same canvas, the
       same slide and the same sticky box carry the closing act, which is the
       whole reason the two were merged: the predicted tumor never leaves the
       screen, so it cannot arrive twice. */
    const E_SHARE = 0.54;

    /* Start, length, and how far the beat is staggered across the cohort, so
       the operation reads as samples being worked through rather than as a
       switch being thrown on all of them at once. */
    const E_STAIN = [0.12, 0.10, 0.09];
    const E_WASH = [0.27, 0.09, 0.09];
    const E_MAP = [0.54, 0.10, 0.09];
    // where the measured cohort starts falling back to make room for the one
    // it is used to predict
    const E_BACK = 0.74;

    const STROMA = [64, 158, 132];

    /* Cell-state colours for the map beat. The clone identities the tissue was
       drawn with, pushed hard away from grey: left at their stained values
       they are pink dots on a pink section, and the whole point of the beat is
       that something has been read off it. Same hues, so a subclone still
       reads as a shade of its parent. */
    function vivid(c, k, lift) {
        const m = (c[0] + c[1] + c[2]) / 3;
        return c.map(v => Math.max(0, Math.min(255, Math.round(m + (v - m) * k + lift))));
    }

    /* Pushed away from grey and then taken down, not up. The cores are light
       enough to carry a cell against blue on their own, but a state dot has to
       hold against paper and against stained tissue, both of which are brighter
       than it is; lifting them the way the blue stage did leaves pale dots on a
       pale section. Same hues throughout, so a subclone still reads as a shade
       of its parent. */
    const STATE = [];
    for (const pal of PALETTES.all) STATE[pal.id] = vivid(pal.core, 2.1, -50);

    function estep(spec, lag) {
        return smooth(clamp01((eq - spec[0] - spec[2] * lag) / spec[1]));
    }

    /* The followed tumor has been drawn live up to now rather than off a
       layout, so it gets one built from the cells it ended on. After this it
       is just another patient in the grid and can be baked like the rest. */
    function ensureHome() {
        const home = cohort.tumors[0];
        if (home.layout) return;
        const built = fullyGrown();
        const bound = boundsRadius(built.cells) || 1;
        home.layout = {
            id: home.pid,
            cells: built.cells.map(c => ({
                px: c.px / bound, py: c.py / bound, pr: c.pr / bound,
                pal: c.pal, pal0: c.pal0, m: c.m, m2: c.m2, v: c.v, lit: c.lit
            }))
        };
        cohort.queue.unshift(home);
        cohort.sections.unshift(home);
    }

    /* The capture lattice: a hex grid over the section, keeping the positions
       that land on tissue. Each spot remembers the cell underneath it, which
       is what lets one lattice read first as addresses on a slide and then as
       the states measured at them. */
    function buildSpots(layout, slotR, pitch) {
        const spots = [];
        const step = slotR * (pitch || 0.2);
        const rows = Math.ceil(slotR * 1.2 / (step * 0.866));
        const cols = Math.ceil(slotR * 1.2 / step);
        for (let ry = -rows; ry <= rows; ry++) {
            const y = ry * step * 0.866;
            const off = (ry & 1) ? step * 0.5 : 0;
            for (let ci = -cols; ci <= cols; ci++) {
                const x = ci * step + off;
                let best = null, bd = Infinity;
                for (const c of layout.cells) {
                    const d = Math.hypot(c.px * slotR - x, c.py * slotR - y);
                    if (d < bd) { bd = d; best = c; }
                }
                if (!best || bd > best.pr * slotR * 1.45) continue;
                spots.push({ x, y, pal: best.pal, m: best.m, k: hash(x * 3.11 + y * 7.73) });
            }
        }
        return spots;
    }

    function growSections(budget) {
        // a section baked before the tissue lands would be the fallback stain,
        // and it is cached for the rest of the page once baked
        if (!HE.settled) return;
        for (let n = 0; n < budget; n++) {
            // whichever is next that has a layout yet, since the sprite pass
            // upstream is still working through building them
            const i = cohort.sections.findIndex(t => t.layout);
            if (i < 0) return;
            const t = cohort.sections.splice(i, 1)[0];
            const R = t.slotR * 1.7;
            const size = Math.max(8, Math.ceil(R * 2 * dpr));
            const cv = document.createElement('canvas');
            cv.width = cv.height = size;
            const g = cv.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.translate(R, R);
            drawSection(g, t.layout.cells, t.slotR, 1.1, t.layout.id);
            t.section = cv;
            t.sectionR = R;
            t.spots = buildSpots(t.layout, t.slotR);
            cohort.drains.push(t);
        }
    }

    /* The washed copy of a section, baked once the grey tissue is in. Kept out of
       the pass above so that a section can be stained and shown while these are
       still downloading: the wash does not happen until a beat later, and a
       section baked against the grey atlas before it lands would be cached with
       the fallback stain in it for the rest of the page. */
    function growDrains(budget) {
        if (!HE.grayReady) return;
        for (let n = 0; n < budget && cohort.drains.length; n++) {
            const t = cohort.drains.shift();
            const R = t.sectionR;
            const size = Math.max(8, Math.ceil(R * 2 * dpr));
            const cv = document.createElement('canvas');
            cv.width = cv.height = size;
            const g = cv.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.translate(R, R);
            drawSection(g, t.layout.cells, t.slotR, 1.1, t.layout.id, 1, true);
            t.drained = cv;
        }
    }

    function drawSpots(g, t, appear, held) {
        // kept well inside the lattice pitch, so the array reads as separate
        // addresses rather than as a sheet of bubbles
        const rr = Math.max(0.8, t.slotR * 0.038);
        for (const s of t.spots) {
            // staggered per spot, so a lattice fills in the way a scan does
            const a = clamp01((appear - s.k * 0.4) / 0.6) * held;
            if (a <= 0.02) continue;
            const state = s.m > 0.42 ? STATE[s.pal.id] : STROMA;
            g.globalAlpha = a;
            g.beginPath();
            g.arc(t.x + s.x, t.y + s.y, rr * 1.3, 0, TAU);
            g.fillStyle = `rgb(${state[0]},${state[1]},${state[2]})`;
            g.fill();
        }
        g.globalAlpha = 1;
    }

    /* The tumor the last beat predicts on: one that has only ever been cut and
       stained. It is not one of the twenty, and it never gets a capture
       lattice, because the whole claim is that it did not need one. */
    function ensureQuery() {
        if (query) return query;
        // bakes its washed copy in the same pass, so it needs the grey tissue too
        if (!HE.grayReady) return null;
        const R = minDim * (wide ? 0.215 : 0.27);
        const span = R * 1.7;
        const layout = buildLayout(9173);
        const size = Math.max(8, Math.ceil(span * 2 * dpr));
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.translate(span, span);
        drawSection(g, layout.cells, R, 1.1, layout.id, 3);
        const gray = document.createElement('canvas');
        gray.width = gray.height = size;
        const gg = gray.getContext('2d');
        gg.setTransform(dpr, 0, 0, dpr, 0, 0);
        gg.translate(span, span);
        drawSection(gg, layout.cells, R, 1.1, layout.id, 3, true);
        query = {
            layout, R, span,
            section: cv,
            drained: gray,
            // finer than the grid's, because at this size the tissue under it
            // has enough detail that the grid's pitch reads as a scattering of
            // dots rather than as a resolved map
            spots: buildSpots(layout, R, 0.115),
            x: fx + fw * (wide ? 0.60 : 0.5),
            // parked high enough that the closing act has somewhere to bring it
            // down to, since the one thing that act must not do is let this
            // slide leave the screen and arrive again
            y: H * (wide ? 0.48 : 0.40)
        };
        return query;
    }

    /* Where the measured cohort ends up once it stops being the subject and
       becomes the thing the model was trained on: small, dim, off to one side. */
    function refFrame() {
        return wide
            ? { s: 0.34, x: fx + fw * 0.855, y: H * 0.17 }
            : { s: 0.42, x: fx + fw * 0.5, y: H * 0.11 };
    }

    function drawQuery(g, arrive, infer, mute) {
        const t = ensureQuery();
        if (!t) return;
        const rise = (1 - arrive) * minDim * 0.04;
        const x = t.x - t.span, y = t.y - t.span + rise, w = t.span * 2;

        /* Stacked rather than cross-faded: both copies are the same picture in
           the same place, so laying the drained one over the stained one at a
           rising alpha reads as the colour leaving. Cross-fading them would take
           both below full opacity in the middle and let the page show through a
           slide that never became transparent. */
        g.globalAlpha = arrive;
        g.drawImage(t.section, x, y, w, w);
        if (mute > 0.003) {
            g.globalAlpha = arrive * mute;
            g.drawImage(t.drained, x, y, w, w);
        }
        g.globalAlpha = 1;

        if (infer > 0.002) {
            const rr = Math.max(1.2, t.R * 0.023);
            for (const s of t.spots) {
                /* Swept across the slide rather than revealed at random: the
                   states are being worked out from the tissue, and a sweep is
                   what that looks like from outside. */
                const u = (s.x / t.R + 1) / 2;
                const a = clamp01((infer * 1.5 - u) / 0.3);
                if (a <= 0.02) continue;
                const state = s.m > 0.42 ? STATE[s.pal.id] : STROMA;
                g.globalAlpha = a * arrive;
                g.beginPath();
                g.arc(t.x + s.x, t.y + s.y + rise, rr, 0, TAU);
                g.fillStyle = `rgb(${state[0]},${state[1]},${state[2]})`;
                g.fill();
            }
            g.globalAlpha = 1;
        }

        if (arrive > 0.4) {
            // reads as an unmeasured slide until the states land on it, which
            // is the only part of the beat the picture cannot say by itself
            const at = (arrive - 0.4) / 0.6;
            const y = t.y + t.R * 1.28 + rise;
            // handed over rather than cross-faded, since the two sit on the
            // same line and any overlap is unreadable
            const before = at * clamp01(1 - infer / 0.22);
            const after = at * clamp01((infer - 0.4) / 0.3);
            if (before > 0.01) label(g, 'PT-' + t.layout.id + ' \u00b7 H&E ONLY', t.x, y, before * 0.6, false, 12);
            if (after > 0.01) label(g, 'PT-' + t.layout.id + ' \u00b7 EXPRESSION PREDICTED', t.x, y, after * 0.9, true, 12);
        }
    }

    function renderEngine(q, vq) {
        if (!cohort) initCohort();
        // normally already in flight from the cohort above, but this stage can
        // be landed on directly
        loadStains();
        ensureHome();
        // dribbled in over the first second rather than built in one go, so the
        // grid fills without a stutter on the frame it is asked for
        growSprites(4);
        growSections(4);
        growDrains(4);

        const g = ectx;
        /* Whose patient a tumor is carries the first beat and is clutter by the
           second, where a label sits on the section in the row below it. Gated
           on the leading tumor rather than on each one's own progress, so the
           whole set of them clears the moment any cutting starts. */
        const ident = 0.36 * (1 - estep(E_STAIN, 0));
        const back = smooth(clamp01((q - E_BACK) / 0.10));
        const arrive = smooth(clamp01((q - E_BACK - 0.06) / 0.09));
        const infer = smooth(clamp01((q - E_BACK - 0.13) / 0.14));
        // led deliberately: the stain is most of the way out before the first
        // state lands, so the slide is seen going blank and then being written
        // on, rather than the two happening at once and reading as a recolour
        const mute = smooth(clamp01((q - E_BACK - 0.09) / 0.08));
        /* The measured cohort is what the prediction was made from, and it has
           said that by the time the closing act starts. It goes rather than
           staying dimmed in the corner, because the next thing to arrive in that
           corner is twenty screened patients and two of those grids on one
           canvas is unreadable. */
        const dim = lerp(1, 0.42, back) * (1 - smooth(clamp01(vq / 0.16)));
        if (dim <= 0.004) return;

        g.save();
        if (back > 0.001) {
            const f = refFrame();
            const s = lerp(1, f.s, back);
            g.translate(lerp(cohort.mid.x, f.x, back), lerp(cohort.mid.y, f.y, back));
            g.scale(s, s);
            g.translate(-cohort.mid.x, -cohort.mid.y);
        }

        for (const t of cohort.tumors) {
            if (!t.sprite) continue;
            const lag = t.order01 || 0;
            const stain = t.section ? estep(E_STAIN, lag) : 0;
            const mapped = estep(E_MAP, lag);
            const wash = t.drained ? estep(E_WASH, lag) : 0;

            if (stain < 0.995) {
                const w = t.spriteR * 2;
                g.globalAlpha = (1 - stain) * dim;
                g.drawImage(t.sprite, t.x - w / 2, t.y - w / 2, w, w);
            }
            if (stain > 0.005) {
                const w = t.sectionR * 2;
                const x = t.x - w / 2, y = t.y - w / 2;
                g.globalAlpha = stain * dim;
                g.drawImage(t.section, x, y, w, w);
                // the stain loses its colour just before the lattice lands, so
                // the readings sit against grey tissue instead of competing
                // with the eosin. fading the section out instead would take the
                // tissue with it
                if (wash > 0.003) {
                    g.globalAlpha = stain * dim * wash;
                    g.drawImage(t.drained, x, y, w, w);
                }
            }
            g.globalAlpha = 1;

            if (t.spots && mapped > 0.005) drawSpots(g, t, mapped, dim);
            if (ident > 0.01 && wide && t.layout) {
                label(g, 'PT-' + t.layout.id, t.x, t.y + t.slotR * 1.5, ident, false);
            }
        }
        g.restore();

        // past the handover the closing act is drawing this same slide, and it
        // is drawing it in the place this act left it
        if (arrive > 0.002 && vq <= 0) drawQuery(g, arrive, infer, mute);
    }

    function renderEngineStage(y, vh) {
        if (!estage || !ectx) return false;
        // read whether or not the stage is on screen, so the eased value is
        // converging on the right target while the loop is winding down
        epTarget = clamp01((y - eTop) / eTravel);
        if (eTop >= y + vh || eTop + eTravel + vh <= y) return false;
        ep = ease(ep, epTarget);
        eq = clamp01(ep / E_SHARE);
        // the two acts butt up against each other with no gap, so the slide is
        // handed from one to the other on a single frame and in one place
        const vq = clamp01((ep - E_SHARE) / (1 - E_SHARE));

        ground = GROUNDS.paper;
        ectx.clearRect(0, 0, W, H);
        renderEngine(eq, vq);
        if (ep >= E_SHARE) {
            // the closing act's subject is the engine act's query, so it cannot
            // start until that slide exists to be handed over
            const subject = ensureQuery();
            if (subject) {
                if (!verdict) initVerdict(subject);
                growVerdict(2);
                renderVerdict(vq);
            }
        }
        erail.style.setProperty('--p', (ep * 100).toFixed(1));
        // unclamped, so the last engine caption fades out on its own as the
        // closing act comes up rather than sticking at full opacity
        const lit = syncCaptions(ecaptions, ep / E_SHARE, engineBeat);

        /* The closing act's own beats. Both are held back until the engine act's
           last caption has gone, because all three occupy the same column and
           any overlap there is headings printed on top of each other.

           The readout has to count them, since they share this stage. Without
           it the count sits at the last engine caption while the rail beside it
           is only halfway down, which reads as the page being stuck. Whichever
           block is carrying more than the captions are wins it. */
        vcopies.forEach((el, i) => {
            const w = V_COPY[i];
            const o = smooth(clamp01((vq - w[0]) / V_COPY_FADE)) * (1 - smooth(clamp01((vq - w[1]) / V_COPY_FADE)));

            el.style.setProperty('--o', o.toFixed(3));
            if (engineBeat && o > lit) engineBeat.textContent = String(ecaptions.length + i + 1);
        });

        return true;
    }

    /* ---------- second act, same stage: who the drug is for ---------- */

    /* The engine act ends on a tumor that was never sequenced, with its
       expression inferred from the stain alone. This picks that same slide up
       where it stands and carries it the one step that matters clinically: the
       predicted map is read for the programmes a drug acts on, the tumor is
       called against the outcomes recorded for the tumors nearest it, and then
       the camera pulls back and the same call is made across everyone screened.

       It is not a lookalike and it is not a second copy. The hero here IS the
       engine act's query object: the same layout, the same baked section, the
       same predicted lattice, drawn into the same canvas. It shares the stage
       and the sticky box with the act before it, which is what lets the slide
       travel down into this one instead of scrolling off the top and being
       rebuilt underneath. */
    let verdict = null;
    const vcopies = Array.from(document.querySelectorAll('.verdict__copy'));

    /* Where each closing beat fades in and where it starts fading out, in the
       closing act's own 0..1. The handover is clean rather than crossfaded, and
       the second lands fully up as the cohort starts separating, because the
       two groups are what that beat is about. */
    const V_COPY = [[0.13, 0.48], [0.56, 9]];
    const V_COPY_FADE = 0.08;

    /* Start and length of each beat, in the closing act's own 0..1.

       DESCEND is the handover: the slide leaves the place the engine act parked
       it and settles where it can be read closely. FACE and SPLIT are kept
       apart on purpose, because a section that starts moving while it is still
       a section is a slide sliding about; it has to finish becoming a person
       first, and only then go and stand with its group. */
    const V_DESCEND = [0.00, 0.10];
    const V_SCORE = [0.09, 0.07];
    const V_CALL = [0.17, 0.04];
    const V_BACK = [0.21, 0.09];
    const V_CLASS = [0.33, 0.09];
    const V_COUNT = [0.47, 0.035];
    const V_FACE = [0.53, 0.085];
    // finished well before the stage runs out, because the two groups are what
    // the whole page has been building to and they have to be held, not glimpsed
    const V_SPLIT = [0.64, 0.15];

    // the probability the followed patient is called on. Well clear of the line
    // rather than borderline: the beat is that the call can be made at all
    const V_PROB = 0.78;
    // and roughly how much of a screened population a targeted drug is for
    const V_RATE = 0.34;

    /* The group a drug is not predicted to work in. Blue is already the page's
       colour for something it has worked out, and the responders have been
       carrying it since the ring landed, so the other group needs its own. Held
       back from a signal red: these are patients, not errors. */
    const V_NO_INK = '176,68,72';

    const vstep = (q, spec) => smooth(clamp01((q - spec[0]) / spec[1]));

    /* label() centres, which is right for an identifier under a tumor and wrong
       for a readout, where the caption and its value sit at opposite ends of the
       same rule and have to stay there as the number changes width. */
    function vtext(g, text, x, y, alpha, accent, size, align) {
        if (alpha <= 0.01) return;
        g.font = `500 ${size}px Inter, system-ui, sans-serif`;
        g.textAlign = align || 'center';
        // accent is usually the flag for "the page worked this out", but the
        // sorted groups each carry their own colour and pass it in directly
        const ink = typeof accent === 'string' ? accent
            : accent ? ground.inkAccent : ground.ink;
        g.fillStyle = `rgba(${ink},${alpha})`;
        g.fillText(text, x, y);
    }

    /* The readout under the slide: a rule that fills to the predicted
       probability. It is the one piece of instrumentation on the page, and it
       is here because a call is a number before it is a word. */
    function drawMeter(g, x, y, w, t, alpha) {
        g.globalAlpha = alpha;
        g.fillStyle = `rgba(${ground.ink},0.13)`;
        g.fillRect(x - w / 2, y, w, 2);
        g.fillStyle = `rgba(${ground.inkAccent},0.92)`;
        g.fillRect(x - w / 2, y, w * t, 2);
        g.globalAlpha = 1;
    }

    /* Slots for the screened cohort, kept clear of the copy column, plus the
       one the followed patient falls back into. Laid out before anything is
       drawn because the zoom-out is an interpolation toward a slot that has to
       exist from the first frame.

       Takes the engine act's query as its subject rather than building one, so
       there is exactly one of that slide on the page and this act cannot
       disagree with the one before it about where it is or what it looks like. */
    function initVerdict(q) {
        const x0 = fx + fw * (wide ? 0.36 : 0.05);
        const x1 = fx + fw * (wide ? 0.96 : 0.95);
        // the copy sits beside the grid on a wide screen and over the top of it
        // on a narrow one, where it is also at its tallest, so the grid starts
        // below the deepest the paragraph gets rather than beside it
        const y0 = wide ? H * 0.10 : H * 0.40;
        const y1 = wide ? H * 0.88 : H * 0.93;
        const rw = x1 - x0, rh = y1 - y0;

        const cols = rw > 900 ? 6 : rw > 620 ? 5 : rw > 420 ? 4 : 3;
        const cellW = rw / cols;
        const rows = Math.max(2, Math.min(5, Math.round(rh / cellW)));
        const cellH = rh / rows;

        const slots = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const j = hash(r * 17.3 + c * 5.9);
                slots.push({
                    x: x0 + cellW * (c + 0.5) + (j - 0.5) * cellW * 0.1,
                    y: y0 + cellH * (r + 0.5) + (hash(r * 9.1 + c * 23.7) - 0.5) * cellH * 0.1,
                    slotR: Math.min(cellW, cellH) * 0.4 * (0.88 + j * 0.22)
                });
            }
        }

        // where the slide is held once it has come down, and the slot nearest it,
        // so the pull-back after that is a step rather than a jump
        const heroX = q.x;
        const heroY = wide ? H * 0.53 : H * 0.62;
        let pick = 0, best = Infinity;
        slots.forEach((s, i) => {
            const d = Math.hypot(s.x - heroX, s.y - heroY);
            if (d < best) { best = d; pick = i; }
        });
        const seat = slots.splice(pick, 1)[0];

        /* The subject, handed over whole. Its section is already baked and its
           lattice already predicted, so nothing about it is rebuilt here; all
           this act adds is where it goes next and which group it is in. */
        const hero = {
            // where the act before this one parked it, which is where this one
            // has to pick it up if the handover is to be invisible
            from: { x: q.x, y: q.y },
            x: seat.x, y: seat.y, slotR: seat.slotR,
            heroR: q.R,
            layout: q.layout, spots: q.spots,
            section: q.section, drained: q.drained, sectionR: q.span,
            yes: true, order01: 0
        };

        const others = slots.map((s, i) => ({
            x: s.x, y: s.y, slotR: s.slotR,
            seed: 5100 + i * 37,
            layout: null, section: null,
            // a screened population is not sorted, so the responders are
            // scattered through the grid rather than gathered in a corner
            yes: hash(i * 13.7 + 2.9) < V_RATE,
            order: Math.hypot(s.x - seat.x, s.y - seat.y)
        }));

        // outward from the followed patient, so the cohort arrives around the
        // one tumor the visitor has been watching instead of filling in rows
        const byDistance = others.slice().sort((a, b) => a.order - b.order);
        byDistance.forEach((t, i) => {
            t.order01 = byDistance.length > 1 ? i / (byDistance.length - 1) : 0;
        });

        verdict = {
            hero, others,
            heroX, heroY,
            // the hero is not in it: its section was cut by the act before this
            // one and handed over already baked
            queue: byDistance,
            mid: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
            responders: others.filter(t => t.yes).length + 1,
            total: others.length + 1
        };
        partition([hero].concat(others), x0, x1, y0, y1);
    }

    /* Where everyone stands once the cohort has been sorted: the predicted
       responders in one block and the rest in another, with a gutter between
       them wide enough that the split is the first thing read.

       Both blocks are packed at the same pitch and drawn at the same size,
       because the only difference the picture is allowed to assert is which
       group someone is in and how many are in it. The smaller block therefore
       ends up small rather than spread out to match, which is the point. */
    function partition(all, x0, x1, y0, y1) {
        const rw = x1 - x0;
        // room above each block for the two lines that name it
        const top = y0 + (wide ? 50 : 42);
        const avail = y1 - top;
        const gut = rw * (wide ? 0.09 : 0.06);
        const boxes = [
            { list: all.filter(t => t.yes) },
            { list: all.filter(t => !t.yes) }
        ];

        /* Columns are settled first and the width handed out in proportion to
           them, rather than the other way round. Splitting the frame by
           headcount and then packing into whatever each side was given lets the
           narrower block set its own pitch, which is how twenty people end up
           drawn at two different sizes. */
        let cols = 0, rows = 0;
        for (const b of boxes) {
            b.cols = Math.max(1, Math.min(b.list.length, Math.round(Math.sqrt(b.list.length * 1.15))));
            b.rows = Math.ceil(b.list.length / b.cols);
            cols += b.cols;
            rows = Math.max(rows, b.rows);
        }
        const pitch = Math.min((rw - gut) / cols, avail / rows);

        // the pair is centred as one object, and both blocks hang from one
        // line, so the only thing that makes one taller is how many are in it
        let x = x0 + (rw - (cols * pitch + gut)) / 2;
        const y = top + (avail - rows * pitch) * 0.42;

        for (const b of boxes) {
            b.x = x;
            b.w = b.cols * pitch;
            b.list.forEach((t, i) => {
                const r = Math.floor(i / b.cols);
                // a last row that does not fill is centred under the ones above
                // it rather than left hanging off the left edge
                const n = Math.min(b.cols, b.list.length - r * b.cols);
                const rowX = b.x + (b.w - n * pitch) / 2;
                t.tx = rowX + pitch * (i - r * b.cols + 0.5);
                t.ty = y + pitch * (r + 0.5);
            });
            b.labelX = b.x + b.w / 2;
            b.labelY = y - 14;
            b.count = b.list.length;
            x += b.w + gut;
        }

        verdict.boxes = boxes;
        verdict.personR = pitch * 0.42;
    }

    /* Same staged bake as the grid above: a section is cut once and kept, a
       couple per frame, so the pull-back never lands on a frame that is busy
       stamping tissue. The followed patient is first in the queue because it is
       the only one on screen for the first third of the loop. */
    function growVerdict(budget) {
        // bakes both copies of a section in one pass, so both atlases are needed
        if (!HE.grayReady) return;
        for (let n = 0; n < budget && verdict.queue.length; n++) {
            const t = verdict.queue.shift();
            if (!t.layout) t.layout = buildLayout(t.seed);
            const shown = t.heroR || t.slotR;
            const R = shown * 1.7;
            const size = Math.max(8, Math.ceil(R * 2 * dpr));
            const cv = document.createElement('canvas');
            cv.width = cv.height = size;
            const g = cv.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.translate(R, R);
            drawSection(g, t.layout.cells, shown, 1.1, t.layout.id, t.heroR ? 3 : 1);
            t.section = cv;
            const gray = document.createElement('canvas');
            gray.width = gray.height = size;
            const gg = gray.getContext('2d');
            gg.setTransform(dpr, 0, 0, dpr, 0, 0);
            gg.translate(R, R);
            drawSection(gg, t.layout.cells, shown, 1.1, t.layout.id, t.heroR ? 3 : 1, true);
            t.drained = gray;
            t.sectionR = R;
        }
    }

    /* What a section turns into once the page has finished talking about
       tissue. Everything above this beat is a measurement; the thing being
       measured was a person the whole time, and the last frame is the only
       place on the page that says so. Head and shoulders, filled flat, at the
       size the page draws an identifier rather than an illustration. */
    function drawPerson(g, x, y, r, ink, alpha) {
        if (alpha <= 0.01) return;
        g.globalAlpha = alpha;
        g.fillStyle = `rgb(${ink})`;
        g.beginPath();
        g.arc(x, y - r * 0.34, r * 0.36, 0, TAU);
        g.fill();
        g.beginPath();
        g.ellipse(x, y + r * 0.74, r * 0.70, r * 0.56, 0, Math.PI, TAU);
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
    }

    /* One patient's figure: it fades up over the section it stands in for and
       then settles to the size the whole cohort is drawn at, so twenty
       different pieces of tissue resolve into twenty of the same thing. */
    function drawFigure(g, t, x, y, face, split, base) {
        if (face <= 0.005) return;
        const r = lerp(t.slotR * 0.86, verdict.personR, split);
        drawPerson(g, x, y, r, t.yes ? ground.inkAccent : V_NO_INK,
            face * base * (t.yes ? 0.92 : 0.66));
    }

    /* What each block of people is. Named rather than counted first, because
       the count only means anything once it is clear what it is a count of. */
    function drawGroups(g, t) {
        const v = verdict;
        const a = smooth(clamp01((t - 0.45) / 0.55));
        if (a <= 0.01) return;
        v.boxes.forEach((b, i) => {
            const yes = i === 0;
            const ink = yes ? ground.inkAccent : V_NO_INK;
            const name = yes
                ? (wide ? 'PREDICTED RESPONDERS' : 'RESPONDERS')
                : (wide ? 'PREDICTED NON-RESPONDERS' : 'NON-RESPONDERS');
            vtext(g, name, b.labelX, b.labelY - 17, a * (yes ? 0.92 : 0.62), ink, wide ? 11 : 10);
            vtext(g, b.count + ' OF ' + v.total, b.labelX, b.labelY,
                a * (yes ? 0.5 : 0.36), false, wide ? 11 : 10);
        });
    }

    function renderVerdict(q) {
        const v = verdict;
        const hero = v.hero;
        const g = ectx;

        const descend = vstep(q, V_DESCEND);
        const score = vstep(q, V_SCORE);
        const call = vstep(q, V_CALL);
        const back = vstep(q, V_BACK);
        const count = vstep(q, V_COUNT);
        const face = vstep(q, V_FACE);
        const split = vstep(q, V_SPLIT);
        // what is left of the tissue: every section is spent against the figure
        // that replaces it, so the two are never both solid in the same frame
        const skin = 1 - face;

        /* Three moves, chained, and everything drawn on the slide is placed off
           the result so the map, the ring and the readout travel with the
           tissue: down from where the engine act parked it, back into its slot
           in the screened cohort, and out to the group it is sorted into. */
        const hx = lerp(lerp(lerp(hero.from.x, v.heroX, descend), hero.x, back), hero.tx, split);
        const hy = lerp(lerp(lerp(hero.from.y, v.heroY, descend), hero.y, back), hero.ty, split);
        const hr = lerp(hero.heroR, hero.slotR, back);
        const k = hr / hero.heroR;

        /* The close prediction stays grey. Its original stain returns as the
           camera pulls back and it rejoins the screened cohort. */
        if (skin > 0.005) {
            const w = hero.sectionR * 2 * k;
            g.globalAlpha = skin;
            g.drawImage(hero.drained || hero.section, hx - w / 2, hy - w / 2, w, w);
            if (back > 0.003) {
                g.globalAlpha = skin * back;
                g.drawImage(hero.section, hx - w / 2, hy - w / 2, w, w);
            }
            g.globalAlpha = 1;
        }

        /* The predicted lattice arrives in the act before this one, so it is
           already lit when this act picks the slide up and there is nothing to
           sweep in again. It is spent against the start of the pull-back rather
           than across it: held half-lit over the arriving cohort a lattice is
           just a smear. What this act is about is the call, not the measurement
           behind it, so the measurement leaves as soon as the camera moves. */
        const close = 1 - smooth(clamp01((q - V_BACK[0]) / 0.06));
        if (close > 0.004) {
            const rr = Math.max(1.1, hr * 0.023);
            for (const s of hero.spots) {
                const state = s.m > 0.42 ? STATE[s.pal.id] : STROMA;
                g.globalAlpha = close;
                g.beginPath();
                g.arc(hx + s.x * k, hy + s.y * k, rr, 0, TAU);
                g.fillStyle = `rgb(${state[0]},${state[1]},${state[2]})`;
                g.fill();
            }
            g.globalAlpha = 1;
        }

        /* The readout, which only exists while the slide is being held up. It is
           a close-up instrument: once the tumor is one of twenty it says nothing
           the ring around it does not already say, so it goes with the zoom.

           Seated well clear of the tissue. A section is cut to the scalloped
           outline its own cells make and runs to about a tenth past the radius
           it was drawn at, so a rule set against that radius lands on the slide
           rather than under it. */
        /* The identifier the act before this one left under the slide, carried
           across the handover so that nothing about the frame changes on the
           frame the two acts swap over. It hands off to the readout, which says
           the same thing and more, and the two are swapped rather than
           cross-faded because they sit on the same line. */
        const carry = clamp01(1 - score / 0.25);
        if (carry > 0.01) {
            label(g, 'PT-' + hero.layout.id + ' \u00b7 EXPRESSION PREDICTED',
                hx, hy + hr * 1.28, carry * 0.9, true, 12);
        }

        const near = close;
        if (score > 0.004 && near > 0.01) {
            // the caption and the value sit at opposite ends of the rule, so it
            // has a length below which they meet in the middle regardless of how
            // small the slide it belongs to is
            const w = Math.max(hero.heroR * 1.5, 190);
            const y = hy + hr * 1.44;
            const shown = Math.round(V_PROB * score * 100);
            drawMeter(g, hx, y, w, V_PROB * score, near);
            vtext(g, 'PREDICTED RESPONSE', hx - w / 2, y - 12, near * 0.5, false, 11, 'left');
            vtext(g, shown + '%', hx + w / 2, y - 12, near * 0.8, true, 11, 'right');
            vtext(g, 'RESPONDER', hx, y + 30, call * near * 0.95, true, 14);
            vtext(g, 'PT-' + hero.layout.id, hx, y + 52, near * 0.4, false, 11);
        }

        /* The screened cohort. Each one arrives as the camera pulls back and is
           then called, and the two are deliberately separate: a grid that
           appears already sorted is a picture of a result, and a grid that fills
           and then resolves is a picture of the work being done. */
        for (const t of v.others) {
            if (!t.section) continue;
            const appear = smooth(clamp01((back - 0.12 - t.order01 * 0.34) / 0.4));
            if (appear <= 0.004) continue;
            const cls = smooth(clamp01((q - V_CLASS[0] - t.order01 * V_CLASS[1]) / 0.09));
            // a patient this drug is not predicted to work in is not marked
            // wrong, it is set down: the same fall-back the shortlist beat uses
            const held = t.yes ? 1 : lerp(1, 0.3, cls);
            const x = lerp(t.x, t.tx, split);
            const y = lerp(t.y, t.ty, split);
            if (skin > 0.005) {
                const w = t.sectionR * 2;
                g.globalAlpha = appear * held * skin;
                g.drawImage(t.section, x - w / 2, y - w / 2, w, w);
                g.globalAlpha = 1;
            }
            if (t.yes && cls > 0.01) {
                drawRing(g, x, y, t.slotR * 1.26, cls * appear * skin);
            }
            drawFigure(g, t, x, y, face, split, appear);
        }

        // the followed patient keeps the ring it was given in close-up, so the
        // mark the visitor watched land is the same mark the cohort is read by
        if (call > 0.01) drawRing(g, hx, hy, hr * 1.26, call * skin);
        drawFigure(g, hero, hx, hy, face, split, 1);

        /* The count over the resolved grid, which is what the sort is about to
           show rather than assert. It goes as the groups arrive, because by
           then each of them is carrying its own half of the same sentence. */
        if (count > 0.01) {
            vtext(g, v.responders + ' OF ' + v.total + ' PREDICTED TO RESPOND',
                v.mid.x, H * (wide ? 0.955 : 0.975),
                count * 0.8 * (1 - smooth(clamp01(split / 0.4))), true, 12);
        }

        drawGroups(g, split);
    }

    /* ---------- chrome ---------- */

    /* readout, when given, is the element showing which beat of the stage this
       is. It takes the caption currently carrying the most opacity rather than
       the nearest data-at, so the number changes on the same frame the words
       under it do. */
    // a beat that holds across an act rather than landing on a point says so
    const spanOf = el => el.dataset.from === undefined ? null : [parseFloat(el.dataset.from), parseFloat(el.dataset.to)];

    function syncCaptions(list, prog, readout) {
        let lead = 0, best = -1;
        list.forEach((el, i) => {
            const at = parseFloat(el.dataset.at);
            const next = i < list.length - 1 ? parseFloat(list[i + 1].dataset.at) : 1.4;
            /* Each caption owns the window between the midpoints of its
               neighbours, so two are never legible at the same time. The first
               owns everything back to the top of the stage, which is as far
               back as there is, rather than back to a neighbour invented for it
               at a fixed distance behind. That invented neighbour sat outside
               the stage, so the opening beat was already at full fade-in on the
               stage's first frame and needed a second ramp bolted on top to stop
               it appearing all at once. */
            /* Most beats are a point and take the window between their
               neighbours. One is not: the biology beat is a whole act, held up
               across the growth and the spread while a list inside it moves its
               own highlight, and a window derived from a midpoint is nowhere near
               wide enough for it. So a beat may declare its own span, and the
               beats either side of it take that span's edge as their boundary
               instead of splitting the difference with its centre. */
            const own = spanOf(el);
            const start = own ? own[0]
                : i > 0 ? (spanOf(list[i - 1]) || [])[1] ?? (parseFloat(list[i - 1].dataset.at) + at) / 2
                : 0;
            const end = own ? own[1]
                : i < list.length - 1 ? (spanOf(list[i + 1]) || [])[0] ?? (at + next) / 2
                : (at + next) / 2;

            /* A crossfade is a share of the window it has to cross, not a fixed
               slice of the stage. Pinned at 0.03 it was wider than the whole of
               the opening beat's window once the stage grew and the beats inside
               the biology were scaled to fit, so that beat began fading out
               before it had finished fading in and never once reached full
               opacity: the two ramps cancelled to a peak of about 0.15. */
            const fade = Math.min(0.03, (end - start) * 0.34);
            const o = clamp01((prog - start) / fade) *
                      (1 - clamp01((prog - (end - fade)) / fade));

            el.style.setProperty('--o', o.toFixed(3));
            if (o > best) { best = o; lead = i; }
        });

        /* Nothing legible means nothing to report, so the number is left where it
           was rather than snapping back to the first beat. A stage whose captions
           hand over to something else halfway down has gaps where no caption is
           carrying anything, and a readout that reset in them counted backwards.

           The winning opacity goes back to the caller, so a stage sharing its
           chrome with a second set of copy can tell which of the two is leading. */
        if (readout && best > 0) {
            const n = String(lead + 1);
            if (readout.textContent !== n) readout.textContent = n;
        }

        return best;
    }

    /* Which cells can be seen, so that a name never puts its dot on one buried
       behind the cell in front of it: the dot lands on paint that belongs to
       something else and the name looks like it is pointing at the wrong colour.
       The mass is painted back to front, so a cell is hidden if anything drawn
       after it covers its middle. Worked out once per layout, since nothing about
       it moves. */
    function markSeen(built) {
        if (built.seen) return;
        built.seen = true;

        const cells = built.cells;
        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            c.bare = true;
            for (let j = i + 1; j < cells.length; j++) {
                const o = cells[j];
                if (Math.abs(o.px - c.px) > o.pr || Math.abs(o.py - c.py) > o.pr) continue;
                if (Math.hypot(o.px - c.px, o.py - c.py) < o.pr * 0.92) { c.bare = false; break; }
            }
        }
    }

    function renderMass() {
        const built = fullyGrown();
        markSeen(built);
        const cells = built.cells;
        const bound = boundsRadius(cells);
        /* Fitted to its band outright rather than eased into it. The figure does
           not move, so there is no arrival to play: a camera converging over a
           second and a half would be the only thing on the screen changing, and
           the reader has no reason to be watching it. */
        const k = Math.min(1.1, figR / Math.max(bound, 1));
        const cyy = figCy();

        const aura = auraTint(cells);
        ctx.save();
        ctx.translate(cx, cyy);
        ctx.scale(k, k);
        pxScale = k * dpr;
        drawAura(bound, aura.tint, 0.16 + aura.avgM * 0.1);
        drawCluster(cells);
        pxScale = dpr;
        ctx.restore();

        /* What anything leaving the mass has to match: the scale it was drawn
           at, and the on-screen size of a tumor cell specifically. Averaging
           over every cell would fold in the healthy ones, which by this point
           are half again the width of the cells that actually escape. */
        let sum = 0, n = 0;
        for (const c of cells) {
            if (c.m <= 0.5) continue;
            sum += c.r; n++;
        }
        return { k, cells, cellR: n ? sum / n : radiusAt(7) * minDim };
    }

    function drawStory(prog) {
        ground = GROUNDS.paper;
        ctx.clearRect(0, 0, W, H);
        if (prog <= META_END) {
            renderFigure();
        } else {
            renderCohort(cohortQ(prog));
        }

        // over the top of the opening beats, and it clears to the cell they end on
        if (prog < BIO_A) renderTrials(prog);
    }

    function frame() {
        baked = 0;
        const y = window.scrollY;
        const vh = window.innerHeight;
        readVelocity(performance.now(), y);
        targetP = readProgress(y);
        p = ease(p, targetP);

        const storyOn = sTop - y < vh && sTop + sTravel + vh - y > 0;
        if (storyOn) {
            drawStory(p);
            railFill.style.setProperty('--p', (p * 100).toFixed(1));
            syncCaptions(captions, p, storyBeat);
        }

        const engineOn = renderEngineStage(y, vh);

        /* Whether there is anything left to do. Both stages off screen and both
           eased values sitting on their targets means the next frame would draw
           the same thing again, so the loop stands down and a scroll starts it
           back up. It used to run at full rate for the whole visit, including
           the several screens of table at the end and any time the tab was in
           the background. */
        if (!document.hidden && (storyOn || engineOn || settling())) {
            raf = requestAnimationFrame(frame);
            return;
        }
        running = false;
    }

    function settling() {
        return Math.abs(p - targetP) > 0.0004 || Math.abs(ep - epTarget) > 0.0004;
    }

    let running = false;
    let raf = 0;

    function kick() {
        if (running || document.hidden) return;
        running = true;
        // restarting after an idle stretch, so the velocity sample is seeded at
        // the current position instead of measuring the whole jump as one frame
        lastY = window.scrollY;
        lastT = performance.now();
        raf = requestAnimationFrame(frame);
    }

    function stop() {
        running = false;
        window.cancelAnimationFrame(raf);
    }

    /* The single cell is the largest thing the page ever draws, so its sprites
       are shaded while the hero is still on screen rather than on the first
       frame of the scroll. One per idle slice, so nothing else is held up. */
    function prebake() {
        const idle = window.requestIdleCallback || (fn => setTimeout(fn, 60));
        const queue = [];
        for (let t = TIERS.length - 1; t >= 0; t--) {
            for (let v = 0; v < SHAPES.length; v++) queue.push([v, t]);
        }
        (function next() {
            const job = queue.shift();
            if (!job) return;
            const key = spriteKey(HEALTHY, job[0], job[1]);
            if (!sprites.has(key)) {
                sprites.set(key, atlas.ready
                    ? cutSprite(HEALTHY, job[0], TIERS[job[1]])
                    : buildSprite(HEALTHY, SHAPES[job[0]], TIERS[job[1]]));
            }
            idle(next);
        })();
    }

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('scroll', kick, { passive: true });

    // a background tab has nothing to draw for, and rAF is throttled rather
    // than stopped there, so the loop is taken down and put back explicitly
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop();
        else kick();
    });

    /* The stage offsets are measured off a laid-out document, and the captions
       are set in a webfont that changes their height when it lands, so they are
       taken again once at each point the layout can still move under them. The
       room the charts get is read off a caption's height, so it goes with them. */
    function remeasure() {
        measureTrials();
        measureStages();
    }

    window.addEventListener('load', remeasure);
    if (document.fonts) document.fonts.ready.then(remeasure);

    resize();
    lastW = canvas.clientWidth;
    lastH = canvas.clientHeight;
    loadAtlas();
    prebake();

    kick();
})();
