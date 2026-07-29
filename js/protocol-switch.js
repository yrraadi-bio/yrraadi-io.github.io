(function () {
    var toggle = document.getElementById('trackToggle');
    var tabs = toggle ? Array.prototype.slice.call(toggle.querySelectorAll('.track-tab')) : [];
    var tracks = Array.prototype.slice.call(document.querySelectorAll('.pipeline-section .pl-track'));
    if (!tracks.length) return;

    var DWELL = 5000;
    var timer = null;
    var activeTrack = 0;

    function railFor(trackIdx) {
        return tracks[trackIdx].querySelector('.pl-rail');
    }

    function stepsFor(trackIdx) {
        return Array.prototype.slice.call(tracks[trackIdx].querySelectorAll('.pl-step'));
    }

    function panelsFor(trackIdx) {
        return Array.prototype.slice.call(tracks[trackIdx].querySelectorAll('.pl-panel'));
    }

    function setStep(trackIdx, stepIdx) {
        var steps = stepsFor(trackIdx);
        var panels = panelsFor(trackIdx);
        steps.forEach(function (step, i) {
            var on = i === stepIdx;
            step.classList.toggle('is-active', on);
            step.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        panels.forEach(function (panel, i) {
            panel.classList.toggle('is-active', i === stepIdx);
        });
    }

    function currentStep(trackIdx) {
        var steps = stepsFor(trackIdx);
        for (var i = 0; i < steps.length; i++) {
            if (steps[i].classList.contains('is-active')) return i;
        }
        return 0;
    }

    function play() {
        stop();
        var rail = railFor(activeTrack);
        if (!rail) return;
        rail.classList.add('is-playing');
        rail.style.setProperty('--pl-dwell', (DWELL / 1000) + 's');
        timer = window.setTimeout(function () {
            var steps = stepsFor(activeTrack);
            var next = (currentStep(activeTrack) + 1) % steps.length;
            setStep(activeTrack, next);
            play();
        }, DWELL);
    }

    function stop() {
        if (timer) { window.clearTimeout(timer); timer = null; }
        var rail = railFor(activeTrack);
        if (rail) rail.classList.remove('is-playing');
    }

    function goTrack(idx) {
        stop();
        activeTrack = idx;
        tabs.forEach(function (tab, i) {
            var on = i === idx;
            tab.classList.toggle('is-active', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        tracks.forEach(function (track, i) {
            track.classList.toggle('is-active', i === idx);
        });
        setStep(idx, 0);
        play();
    }

    tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { goTrack(i); });
    });

    tracks.forEach(function (track, trackIdx) {
        stepsFor(trackIdx).forEach(function (step, stepIdx) {
            step.addEventListener('click', function () {
                setStep(trackIdx, stepIdx);
                play();
            });
        });

        var explorer = track.querySelector('.pl-explorer');
        if (explorer) {
            explorer.addEventListener('mouseenter', stop);
            explorer.addEventListener('mouseleave', function () {
                if (track.classList.contains('is-active')) play();
            });
        }
    });

    var section = document.getElementById('platform');
    if (section && 'IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) { play(); } else { stop(); }
            });
        }, { threshold: 0.25 });
        io.observe(section);
    } else {
        play();
    }
})();
