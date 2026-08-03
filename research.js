/* Holds the three research films back until their card is near the screen.

   They come to 14MB between them and sit at the very bottom of a page that is
   twenty-seven screens long, so fetching them on arrival spends the whole of a
   phone's first megabytes on something most visitors never scroll to. Each one
   is given its source the first time its card comes within a screen of the
   viewport, and started once it has enough to play. */
(function () {
    const films = Array.from(document.querySelectorAll('.paper__film'));
    if (!films.length) return;

    function load(film) {
        if (film.src) return;
        film.src = film.dataset.film;
        film.play().catch(function () { /* a browser that will not autoplay leaves the first frame up */ });
    }

    if (!('IntersectionObserver' in window)) {
        films.forEach(load);
        return;
    }

    const watch = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            load(entry.target);
            watch.unobserve(entry.target);
        });
    }, { rootMargin: '100% 0px' });

    films.forEach(function (film) { watch.observe(film); });
})();
