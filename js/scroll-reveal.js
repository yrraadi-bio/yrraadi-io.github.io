(function () {
    const elements = document.querySelectorAll('[data-reveal]');

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;

                const el = entry.target;
                const delay = parseInt(el.dataset.delay || '0', 10);

                setTimeout(() => {
                    el.classList.add('revealed');
                }, delay);

                observer.unobserve(el);
            });
        },
        { threshold: 0.15 }
    );

    elements.forEach((el) => observer.observe(el));
})();
