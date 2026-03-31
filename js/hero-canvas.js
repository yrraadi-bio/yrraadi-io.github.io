(function () {
    var canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w, h, particles, blobs;
    var mouse = { x: -9999, y: -9999 };

    var COLORS = [
        [27, 54, 93],
        [20, 68, 120],
        [35, 50, 85]
    ];

    var FLUO = [
        [40, 100, 200],
        [80, 60, 200],
        [30, 160, 140],
        [60, 130, 220],
        [120, 80, 190],
        [20, 140, 180],
        [50, 80, 180]
    ];

    function resize() {
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        w = rect.width;
        h = rect.height;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initBlobs() {
        blobs = [];
        var r = Math.max(w, h) * 0.55;
        blobs.push({
            x: w * 0.5, y: h * 0.42,
            rx: r, ry: r,
            color: [50, 120, 220],
            alpha: 0.28,
            glow: 1.1,
            phase: 0, speed: 0.0002, vx: 0, vy: 0
        });
        blobs.push({
            x: w * 0.38, y: h * 0.35,
            rx: r * 0.6, ry: r * 0.55,
            color: [130, 60, 210],
            alpha: 0.2,
            glow: 1.1,
            phase: 1.2, speed: 0.0003, vx: 0, vy: 0
        });
        blobs.push({
            x: w * 0.62, y: h * 0.5,
            rx: r * 0.65, ry: r * 0.6,
            color: [30, 190, 120],
            alpha: 0.2,
            glow: 1.1,
            phase: 2.8, speed: 0.00025, vx: 0, vy: 0
        });
    }

    function init() {
        var count = Math.min(90, Math.floor((w * h) / 12000));
        particles = [];
        for (var i = 0; i < count; i++) {
            var ci = Math.random() < 0.6 ? 0 : Math.random() < 0.6 ? 1 : 2;
            particles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                r: Math.random() * 2 + 0.8,
                a: Math.random() * 0.25 + 0.06,
                c: COLORS[ci],
                ph: Math.random() * 6.2832
            });
        }
        initBlobs();
    }

    function drawBlobs(t) {
        for (var i = 0; i < blobs.length; i++) {
            var b = blobs[i];
            var pulse = Math.sin(t * b.speed + b.phase) * 0.25 + 0.75;
            var a = b.alpha * pulse;

            b.x += b.vx;
            b.y += b.vy;
            if (b.x < -150) b.x += w + 300;
            if (b.x > w + 150) b.x -= w + 300;
            if (b.y < -150) b.y += h + 300;
            if (b.y > h + 150) b.y -= h + 300;

            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.scale(1, b.ry / b.rx);
            var gr = b.rx * b.glow;
            var grd = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
            var c = b.color;
            grd.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')');
            grd.addColorStop(0.4, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a * 0.6) + ')');
            grd.addColorStop(0.75, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a * 0.2) + ')');
            grd.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
            ctx.beginPath();
            ctx.arc(0, 0, gr, 0, 6.2832);
            ctx.fillStyle = grd;
            ctx.fill();
            ctx.restore();
        }
    }

    function frame(t) {
        ctx.clearRect(0, 0, w, h);
        var s = t * 0.0008;

        drawBlobs(t);

        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];
            var dx = p.x - mouse.x;
            var dy = p.y - mouse.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 160 && dist > 0) {
                var f = (160 - dist) / 160 * 0.12;
                p.vx += (dx / dist) * f;
                p.vy += (dy / dist) * f;
            }
            p.vx *= 0.986;
            p.vy *= 0.986;
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < -40) p.x += w + 80;
            if (p.x > w + 40) p.x -= w + 80;
            if (p.y < -40) p.y += h + 80;
            if (p.y > h + 40) p.y -= h + 80;
        }

        for (var i = 0; i < particles.length; i++) {
            for (var j = i + 1; j < particles.length; j++) {
                var dx = particles[i].x - particles[j].x;
                var dy = particles[i].y - particles[j].y;
                var d2 = dx * dx + dy * dy;
                if (d2 < 18000) {
                    var d = Math.sqrt(d2);
                    var alpha = (1 - d / 134) * 0.06;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = 'rgba(27,54,93,' + alpha + ')';
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];
            var pulse = Math.sin(s + p.ph) * 0.18 + 0.82;
            var alpha = p.a * pulse;
            var c = p.c;

            if (p.r > 1.8) {
                var grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
                grd.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (alpha * 0.2) + ')');
                grd.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r * 4, 0, 6.2832);
                ctx.fillStyle = grd;
                ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, 6.2832);
            ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
            ctx.fill();
        }

        requestAnimationFrame(frame);
    }

    resize();
    init();
    requestAnimationFrame(frame);

    window.addEventListener('resize', function () {
        resize();
        init();
    });

    document.addEventListener('mousemove', function (e) {
        var rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
    });

    document.addEventListener('mouseleave', function () {
        mouse.x = -9999;
        mouse.y = -9999;
    });

    var nav = document.getElementById('siteNav');
    if (nav) {
        window.addEventListener('scroll', function () {
            nav.classList.toggle('scrolled', window.scrollY > 60);
        }, { passive: true });
    }
})();
