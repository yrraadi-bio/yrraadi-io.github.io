(function () {
    var container = document.getElementById('pipelineScroll');
    if (!container) return;

    var steps = Array.from(container.querySelectorAll('.pipe-step'));
    var dots = Array.from(document.querySelectorAll('.progress-dot'));
    var n = steps.length;
    if (n === 0) return;

    var current = 0;
    steps[0].classList.add('active');
    dots[0].classList.add('active');

    function update() {
        var rect = container.getBoundingClientRect();
        var scrollable = container.offsetHeight - window.innerHeight;
        if (scrollable <= 0) return;

        var progress = Math.max(0, Math.min(1, -rect.top / scrollable));
        var step = Math.round(progress * (n - 1));
        step = Math.max(0, Math.min(n - 1, step));

        if (step !== current) {
            steps[current].classList.remove('active');
            dots[current].classList.remove('active');
            current = step;
            steps[current].classList.add('active');
            dots[current].classList.add('active');
        }
    }

    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
})();
