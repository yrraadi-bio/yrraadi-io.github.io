(function () {
    var container = document.getElementById('pipelineScroll');
    if (!container) return;

    var steps = Array.from(container.querySelectorAll('.pipe-step'));
    var n = steps.length;
    if (n === 0) return;

    var currentTz = [];
    var currentTy = [];
    var currentOp = [];

    for (var i = 0; i < n; i++) {
        currentTz.push(-800);
        currentTy.push(0);
        currentOp.push(0);
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    var running = false;

    function tick() {
        var rect = container.getBoundingClientRect();
        var scrollable = container.offsetHeight - window.innerHeight;
        if (scrollable <= 0) { running = false; return; }

        var progress = Math.max(0, Math.min(1, -rect.top / scrollable));
        var sp = progress * (n - 1);

        var needsMore = false;
        var ease = 0.12;

        for (var i = 0; i < n; i++) {
            var diff = sp - i;
            var targetTz = 0, targetTy = 0, targetOp = 0;

            if (diff < -1) {
                targetTy = 0;
                targetTz = -800;
                targetOp = 0;
            } else if (diff < 0) {
                var t = diff + 1; // 0 to 1
                var easeT = t * (2 - t); // ease out for position
                targetTy = 0;
                targetTz = -800 * (1 - easeT);
                
                // Opacity stays 0 until t=0.3, then fades in
                targetOp = t < 0.3 ? 0 : Math.pow((t - 0.3) / 0.7, 2);
            } else if (diff <= 1) {
                var t = diff; // 0 to 1
                targetTy = 0;
                targetTz = 1000 * t;
                
                // Opacity fades out by t=0.7
                targetOp = t > 0.7 ? 0 : 1 - Math.pow(t / 0.7, 2);
            } else {
                targetTy = 0;
                targetTz = 1000;
                targetOp = 0;
            }

            currentTz[i] = lerp(currentTz[i], targetTz, ease);
            currentTy[i] = lerp(currentTy[i], targetTy, ease);
            currentOp[i] = lerp(currentOp[i], targetOp, ease);

            if (Math.abs(currentTz[i] - targetTz) > 0.5 || Math.abs(currentTy[i] - targetTy) > 0.5 || Math.abs(currentOp[i] - targetOp) > 0.005) {
                needsMore = true;
            }

            steps[i].style.transform = 'translate(-50%, calc(-50% + ' + currentTy[i].toFixed(1) + 'px)) translateZ(' + currentTz[i].toFixed(1) + 'px)';
            steps[i].style.opacity = Math.max(0, Math.min(1, currentOp[i])).toFixed(3);
            
            if (currentOp[i] > 0.1) {
                steps[i].classList.add('revealed');
            } else {
                steps[i].classList.remove('revealed');
            }
        }

        if (needsMore) {
            requestAnimationFrame(tick);
        } else {
            running = false;
        }
    }

    function requestUpdate() {
        if (!running) {
            running = true;
            requestAnimationFrame(tick);
        }
    }

    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    requestUpdate();
})();
