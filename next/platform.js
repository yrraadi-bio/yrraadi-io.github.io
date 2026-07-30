/* Loads the live workspace into the hero window, and hands the page's scroll back
   when the visitor is done with it. */
(function () {
    const app = document.querySelector('.app');
    if (!app) return;

    const body = app.querySelector('.app__body');
    const demo = app.dataset.demo;
    if (!body || !demo) return;

    const ACCESS_TO = 'yash@origin.bio';
    const REACHABLE = 12000;  /* silence past this and the host is called unreachable */
    const SETTLE = 4200;      /* engaged hint retires this long after the last gesture */

    /* Only the workspace's own origin is allowed to drive anything on this page */
    const allowed = new URL(demo, window.location.href).origin;

    /* A phone cannot give a three-dock workstation a usable size, so the frame is
       never mounted there and a tap opens it in a tab of its own instead. Read
       live rather than once: a tablet turned on its side crosses this line
       without a reload. */
    const narrow = window.matchMedia('(max-width: 860px)');

    let frame = null;
    let deadline = 0;
    let settle = 0;

    function fail() {
        window.clearTimeout(deadline);
        app.classList.remove('is-loading');
        app.classList.add('is-failed');
    }

    function ready() {
        if (app.classList.contains('is-ready')) return;
        window.clearTimeout(deadline);
        app.classList.remove('is-loading', 'is-failed');
        app.classList.add('is-ready');
    }

    /* Keep the escape hint up while the viewer is being driven, retire it once it
       has been still, and bring it back the moment it is touched again. */
    function hold() {
        window.clearTimeout(settle);
        app.classList.remove('is-settled');
        settle = window.setTimeout(function () { app.classList.add('is-settled'); }, SETTLE);
    }

    function engage() {
        if (!app.classList.contains('is-ready')) return;
        app.classList.add('is-engaged');
        hold();
    }

    function release() {
        window.clearTimeout(settle);
        app.classList.remove('is-engaged', 'is-settled');
    }

    function mount() {
        if (frame || narrow.matches) return;

        app.classList.add('is-loading');

        frame = document.createElement('iframe');
        frame.className = 'app__frame';
        frame.title = 'Origin Spatial workspace';
        frame.referrerPolicy = 'no-referrer';
        frame.allow = 'fullscreen';

        /* Whichever lands first reveals it. The workspace announces itself once it
           has booted, which is the honest signal, but a build without that message
           would otherwise sit behind the poster until the deadline and be called
           unreachable while running perfectly well behind it. */
        frame.addEventListener('load', ready);
        frame.src = demo;
        body.appendChild(frame);

        deadline = window.setTimeout(fail, REACHABLE);
    }

    /* The window is in the hero, so there is nothing to wait for on the way in */
    mount();

    /* Taking the wheel is opt-in, because the viewer inside zooms with it and a
       frame that is live on arrival stops the page dead the first time someone
       scrolls with the cursor over the tissue.

       The same first gesture retires the notice. It has to: the card sits over the
       corner the workspace keeps its slide picker in, and until the frame is live
       no click can reach that picker anyway, so dismissing here costs nothing and
       leaving the card up would block the control underneath it. */
    body.addEventListener('pointerdown', function () {
        if (narrow.matches) {
            window.open(demo, '_blank', 'noopener');
            return;
        }
        app.classList.add('is-acked');
        if (app.classList.contains('is-engaged')) hold();
        else engage();
    });

    /* Both ways out: the key, and going about the rest of the page */
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') release();
    });

    document.addEventListener('pointerdown', function (event) {
        if (!app.contains(event.target)) release();
    }, true);

    window.addEventListener('message', function (event) {
        if (event.origin !== allowed || !event.data || typeof event.data !== 'object') return;

        if (event.data.type === 'origin:demo-ready') {
            ready();
            return;
        }

        /* The window chrome names the slide, and the visitor can change it from
           inside the frame, so the label is told rather than written down */
        if (event.data.type === 'origin:slide') {
            const label = app.querySelector('.app__meta-text');
            const cells = Number(event.data.cells);
            if (label) label.textContent = String(event.data.name).slice(0, 60) + (cells > 0 ? ' \u00b7 ' + cells.toLocaleString() + ' predicted cells' : '');
            return;
        }

        /* The locked tabs ask for access from inside the frame, which cannot
           navigate the top window itself. The tab that was reached for rides along
           in the subject, because which wall someone hit is the useful half of the
           signal and this is the only place it survives. */
        if (event.data.type === 'origin:access') {
            const tab = String(event.data.tab || '').slice(0, 40);
            const subject = tab ? 'Platform access \u2014 ' + tab : 'Platform access';
            window.location.href = 'mailto:' + ACCESS_TO + '?subject=' + encodeURIComponent(subject);
        }
    });
})();
