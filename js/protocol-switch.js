(function () {
    var toggle = document.getElementById('trackToggle');
    if (!toggle) return;

    var tabs = Array.prototype.slice.call(toggle.querySelectorAll('.track-tab'));
    var tracks = Array.prototype.slice.call(document.querySelectorAll('.pipeline-section .pl-track'));
    if (!tabs.length || !tracks.length) return;

    function go(idx) {
        tabs.forEach(function (tab, i) {
            var on = i === idx;
            tab.classList.toggle('is-active', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        tracks.forEach(function (track) {
            track.classList.toggle('is-active', String(idx) === track.getAttribute('data-track'));
        });
    }

    tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { go(i); });
    });
})();
