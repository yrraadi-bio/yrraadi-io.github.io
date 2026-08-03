/* Loads the live workspace into the hero window, and hands the page's scroll back
   when the visitor is done with it. */
(function () {
    const app = document.querySelector('.app');
    if (!app) return;

    const body = app.querySelector('.app__body');
    const demo = app.dataset.demo;
    if (!body || !demo) return;

    const REACHABLE = 12000;  /* silence past this and the host is called unreachable */
    const SETTLE = 4200;      /* engaged hint retires this long after the last gesture */

    /* Only the workspace's own origin is allowed to drive anything on this page */
    const allowed = new URL(demo, window.location.href).origin;

    /* A phone drives this window the same way a desktop does, and needs one thing
       a desktop does not: something to press to give the page its scroll back.
       There is no Escape key to release with, and a frame that has taken the
       touch is a frame the visitor cannot scroll off. */
    const done = app.querySelector('.app__done');

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
        if (frame) return;

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
        app.classList.add('is-acked');
        if (app.classList.contains('is-engaged')) hold();
        else engage();
    });

    /* The way out on a phone, where there is no key to press and the frame under
       the finger is holding the scroll. It sits in the window's own title bar,
       outside the frame, so it is reachable while the workspace has the touch. */
    done.addEventListener('click', release);

    /* Both ways out on a desktop: the key, and going about the rest of the page */
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

        /* The locked tabs ask for access from inside the frame, which cannot reach
           the page's form itself. The four fields come with the request rather than
           just the tab, so someone who has already filled them in behind the gate is
           not handed an empty copy of the same form. The tab rides along too, because
           which wall someone hit is the useful half of the signal. */
        if (event.data.type === 'origin:access') {
            const text = function (value) { return String(value == null ? '' : value).slice(0, 120); };
            document.dispatchEvent(new CustomEvent('origin:access', { detail: {
                tab: text(event.data.tab).slice(0, 40),
                firstName: text(event.data.firstName),
                lastName: text(event.data.lastName),
                email: text(event.data.email),
                company: text(event.data.company)
            } }));
        }
    });
})();
