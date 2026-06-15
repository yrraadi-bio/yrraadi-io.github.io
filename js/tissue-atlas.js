(function () {
    var canvas = document.getElementById('atlasCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var stages = document.getElementById('atlasStages');
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var W = 0, H = 0, DPR = 1;

    // --- intensity / nuclei sampling grid (filled once the image loads) ---
    var GW = 150, GH = 66;
    var dens = new Float32Array(GW * GH);   // hematoxylin (nuclei) density
    var nuclei = [];                          // transcriptomic read points
    var marks = [];                           // perturbation markers
    var nodes = [];                           // model lattice nodes
    var particles = [];
    var ready = false;

    var img = new Image();
    var coverSX = 0, coverSY = 0, coverSW = 0, coverSH = 0;

    function smoothstep(a, b, x) {
        var t = (x - a) / (b - a);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return t * t * (3 - 2 * t);
    }

    function buildFromImage() {
        // cover-fit the image into a 16:7 frame, sampled into the grid
        var frameAspect = 16 / 7;
        var iw = img.naturalWidth, ih = img.naturalHeight;
        var ia = iw / ih;
        if (ia > frameAspect) { coverSH = ih; coverSW = ih * frameAspect; coverSY = 0; coverSX = (iw - coverSW) / 2; }
        else { coverSW = iw; coverSH = iw / frameAspect; coverSX = 0; coverSY = (ih - coverSH) / 2; }

        var oc = document.createElement('canvas');
        oc.width = GW; oc.height = GH;
        var octx = oc.getContext('2d');
        octx.drawImage(img, coverSX, coverSY, coverSW, coverSH, 0, 0, GW, GH);
        var data = octx.getImageData(0, 0, GW, GH).data;

        var i = 0;
        for (var p = 0; p < GW * GH; p++) {
            var r = data[i], g = data[i + 1], b = data[i + 2]; i += 4;
            var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            // hematoxylin: dark + blue/purple bias
            var blueBias = (b - g) / 255;
            var d = smoothstep(0.62, 0.18, lum) * 0.85 + Math.max(0, blueBias) * 0.6;
            dens[p] = d > 1 ? 1 : d;
        }

        // transcriptomic read points, denser where nuclei are dense
        nuclei = []; marks = [];
        var tries = 0;
        while (nuclei.length < 230 && tries < 9000) {
            tries++;
            var gx = Math.floor(Math.random() * GW), gy = Math.floor(Math.random() * GH);
            var dv = dens[gy * GW + gx];
            if (Math.random() < dv * dv * 1.3) {
                nuclei.push({
                    x: (gx + Math.random()) / GW,
                    y: (gy + Math.random()) / GH,
                    r: 0.8 + Math.random() * 1.5,
                    ph: Math.random() * 6.2832,
                    a: 0.4 + dv * 0.5
                });
            }
        }
        for (var m = 0; m < 16; m++) {
            var n = nuclei[Math.floor(Math.random() * nuclei.length)];
            if (n && n.x > 0.34) marks.push({ x: n.x, y: n.y, ph: Math.random() * 6.2832 });
        }

        // model lattice: a structured grid of nodes on the right, lightly jittered
        nodes = [];
        var cols = 7, rows = 5;
        for (var c = 0; c < cols; c++) {
            for (var rr = 0; rr < rows; rr++) {
                nodes.push({
                    x: 0.66 + (c / (cols - 1)) * 0.30,
                    y: 0.22 + (rr / (rows - 1)) * 0.56,
                    jx: (Math.random() - 0.5) * 0.012,
                    jy: (Math.random() - 0.5) * 0.02,
                    ph: Math.random() * 6.2832
                });
            }
        }

        // flowing particles left -> right
        particles = [];
        for (var pp = 0; pp < 46; pp++) {
            particles.push({
                x: Math.random(),
                y: 0.5 + (Math.random() - 0.5) * 0.5,
                sp: 0.0006 + Math.random() * 0.0011,
                r: 0.6 + Math.random() * 1.0,
                a: 0.15 + Math.random() * 0.25
            });
        }

        ready = true;
    }

    img.onload = buildFromImage;
    img.src = 'assets/he/he_tissue.jpg';

    function resize() {
        var rect = canvas.getBoundingClientRect();
        if (!rect.width) return;
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = rect.width; H = rect.height;
        canvas.width = Math.round(W * DPR);
        canvas.height = Math.round(H * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    // presence ramps across the band (x in 0..1)
    function rawAlpha(x) { return 1 - smoothstep(0.30, 0.60, x) * 0.86; }
    function dataAlpha(x) { return smoothstep(0.24, 0.42, x) * (1 - smoothstep(0.66, 0.92, x)); }
    function modelAlpha(x) { return smoothstep(0.58, 0.74, x); }

    var heatLo = [56, 175, 170], heatHi = [22, 50, 92];

    function drawHeat() {
        var cw = W / GW, ch = H / GH;
        for (var gy = 0; gy < GH; gy++) {
            for (var gx = 0; gx < GW; gx++) {
                var x = (gx + 0.5) / GW;
                var da = dataAlpha(x);
                if (da < 0.02) continue;
                var d = dens[gy * GW + gx];
                if (d < 0.08) continue;
                var k = d;
                var rr = heatLo[0] + (heatHi[0] - heatLo[0]) * k;
                var gg = heatLo[1] + (heatHi[1] - heatLo[1]) * k;
                var bb = heatLo[2] + (heatHi[2] - heatLo[2]) * k;
                ctx.fillStyle = 'rgba(' + (rr | 0) + ',' + (gg | 0) + ',' + (bb | 0) + ',' + (da * (0.18 + d * 0.55)) + ')';
                ctx.fillRect(gx * cw, gy * ch, cw + 1, ch + 1);
            }
        }
    }

    function drawGrid() {
        ctx.save();
        ctx.lineWidth = 1;
        var n = 26;
        for (var i = 1; i < n; i++) {
            var x = i / n;
            var a = dataAlpha(x) * 0.10;
            if (a < 0.01) continue;
            ctx.strokeStyle = 'rgba(27,54,93,' + a + ')';
            ctx.beginPath(); ctx.moveTo(x * W, 0); ctx.lineTo(x * W, H); ctx.stroke();
        }
        var m = 11;
        for (var j = 1; j < m; j++) {
            ctx.beginPath();
            for (var k = 0; k < n; k++) {
                var xx = (k + 0.5) / n;
                var aa = dataAlpha(xx) * 0.09;
                ctx.strokeStyle = 'rgba(27,54,93,' + aa + ')';
            }
            // simple horizontal lines modulated by mid presence
            var midA = dataAlpha(0.45) * 0.07;
            ctx.strokeStyle = 'rgba(27,54,93,' + midA + ')';
            ctx.moveTo(W * 0.24, (j / m) * H); ctx.lineTo(W * 0.66, (j / m) * H); ctx.stroke();
        }
        ctx.restore();
    }

    function drawNuclei(time) {
        for (var i = 0; i < nuclei.length; i++) {
            var p = nuclei[i];
            var a = dataAlpha(p.x);
            if (a < 0.03) continue;
            var tw = reduceMotion ? 1 : (Math.sin(time * 0.0016 + p.ph) * 0.22 + 0.86);
            ctx.beginPath();
            ctx.arc(p.x * W, p.y * H, p.r, 0, 6.2832);
            ctx.fillStyle = 'rgba(40,178,165,' + (p.a * a * tw) + ')';
            ctx.fill();
        }
        for (var m = 0; m < marks.length; m++) {
            var q = marks[m];
            var ma = dataAlpha(q.x) * 0.7;
            if (ma < 0.03) continue;
            var x = q.x * W, y = q.y * H;
            ctx.strokeStyle = 'rgba(120,70,210,' + ma + ')';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
            ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
            ctx.stroke();
        }
    }

    function drawModel(time) {
        // connections
        for (var i = 0; i < nodes.length; i++) {
            var a = nodes[i];
            var aa = modelAlpha(a.x);
            if (aa < 0.04) continue;
            var ax = (a.x + a.jx) * W, ay = (a.y + a.jy) * H;
            for (var j = i + 1; j < nodes.length; j++) {
                var b = nodes[j];
                var dx = a.x - b.x, dy = a.y - b.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0.13) continue;
                var bb = modelAlpha(b.x);
                var la = Math.min(aa, bb) * (1 - dist / 0.13) * 0.32;
                if (la < 0.01) continue;
                ctx.strokeStyle = 'rgba(27,54,93,' + la + ')';
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo((b.x + b.jx) * W, (b.y + b.jy) * H);
                ctx.stroke();
            }
        }
        // nodes
        for (var k = 0; k < nodes.length; k++) {
            var n = nodes[k];
            var na = modelAlpha(n.x);
            if (na < 0.04) continue;
            var tw = reduceMotion ? 1 : (Math.sin(time * 0.0014 + n.ph) * 0.2 + 0.85);
            ctx.beginPath();
            ctx.arc((n.x + n.jx) * W, (n.y + n.jy) * H, 2.4, 0, 6.2832);
            ctx.fillStyle = 'rgba(27,54,93,' + (na * 0.85 * tw) + ')';
            ctx.fill();
        }
    }

    function drawParticles(time) {
        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];
            if (!reduceMotion) {
                p.x += p.sp;
                if (p.x > 1.02) { p.x = -0.02; p.y = 0.5 + (Math.random() - 0.5) * 0.5; }
            }
            var fade = smoothstep(0.0, 0.1, p.x) * (1 - smoothstep(0.9, 1.0, p.x));
            ctx.beginPath();
            ctx.arc(p.x * W, p.y * H, p.r, 0, 6.2832);
            ctx.fillStyle = 'rgba(45,150,180,' + (p.a * fade) + ')';
            ctx.fill();
        }
    }

    function drawTissue() {
        // draw cover image across full band
        ctx.drawImage(img, coverSX, coverSY, coverSW, coverSH, 0, 0, W, H);
        // fade the raw tissue out toward the right
        var g = ctx.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0.0, 'rgba(0,0,0,1)');
        g.addColorStop(0.30, 'rgba(0,0,0,1)');
        g.addColorStop(0.62, 'rgba(0,0,0,0.14)');
        g.addColorStop(1.0, 'rgba(0,0,0,0.04)');
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
    }

    function feather() {
        // vertical feather (ribbon melts into the page top & bottom)
        var v = ctx.createLinearGradient(0, 0, 0, H);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(0.16, 'rgba(0,0,0,1)');
        v.addColorStop(0.84, 'rgba(0,0,0,1)');
        v.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, W, H);
        // soft far-left & far-right feather
        var hgrad = ctx.createLinearGradient(0, 0, W, 0);
        hgrad.addColorStop(0, 'rgba(0,0,0,0)');
        hgrad.addColorStop(0.05, 'rgba(0,0,0,1)');
        hgrad.addColorStop(0.95, 'rgba(0,0,0,1)');
        hgrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = hgrad;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
    }

    var last = 0;
    function frame(time) {
        if (!ready || W === 0) { requestAnimationFrame(frame); return; }
        if (time - last < 30) { requestAnimationFrame(frame); return; }
        last = time;

        ctx.clearRect(0, 0, W, H);
        drawTissue();
        drawHeat();
        drawGrid();
        drawNuclei(time);
        drawParticles(time);
        drawModel(time);
        feather();

        if (reduceMotion) return;
        requestAnimationFrame(frame);
    }

    resize();
    requestAnimationFrame(frame);
    if (stages) window.setTimeout(function () { stages.classList.add('is-in'); }, 500);

    var rt;
    window.addEventListener('resize', function () {
        clearTimeout(rt);
        rt = setTimeout(resize, 120);
    }, { passive: true });
})();
