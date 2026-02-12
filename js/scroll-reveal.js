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

(function () {
    const videos = document.querySelectorAll('.blog-video');
    if (!videos.length) return;

    const tryPlay = (video) => {
        video.autoplay = true;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        const p = video.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    };

    videos.forEach((video) => {
        tryPlay(video);
        video.addEventListener('loadedmetadata', () => tryPlay(video));
    });

    const resumeAll = () => videos.forEach(tryPlay);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) resumeAll();
    });
    window.addEventListener('focus', resumeAll);
    document.addEventListener('touchstart', resumeAll, { once: true });
})();

(function () {
    const carousel = document.querySelector('.advisors-grid');
    const dots = Array.from(document.querySelectorAll('.advisor-dot'));
    if (!carousel || dots.length === 0) return;

    const cards = Array.from(carousel.querySelectorAll('.advisor-card'));
    if (cards.length === 0) return;

    const setActiveDot = (index) => {
        dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
    };

    const updateFromScroll = () => {
        const center = carousel.getBoundingClientRect().left + carousel.clientWidth / 2;
        let bestIndex = 0;
        let bestDistance = Infinity;
        cards.forEach((card, index) => {
            const rect = card.getBoundingClientRect();
            const cardCenter = rect.left + rect.width / 2;
            const distance = Math.abs(cardCenter - center);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        });
        setActiveDot(Math.min(bestIndex, dots.length - 1));
    };

    carousel.addEventListener('scroll', updateFromScroll, { passive: true });
    window.addEventListener('resize', updateFromScroll);
    updateFromScroll();
})();
