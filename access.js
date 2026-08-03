/* The way in. Every "get access" on the page opens this form rather than a mail
   client: a mailto hands the visitor to whatever their machine has registered,
   which on a shared or work laptop is often nothing at all, and what comes back
   is an unstructured message rather than four fields we can act on. */
(function () {
    const gate = document.getElementById('gate');
    const form = document.getElementById('gateForm');
    if (!gate || !form) return;

    /* Where a request is written down: a Google Apps Script web app bound to the
       sheet, which appends one row per submission. The source is in
       _dev/access-endpoint.gs, and an edit there only takes effect once it is
       redeployed as a new version. The body goes as text/plain on purpose: any
       other content type makes the browser send a preflight, which Apps Script
       does not answer.

       If the request does not land, the form says so. It does not fall back to a
       mail client: handing the visitor to their mail is the thing this form
       exists to replace, and someone who has just typed four fields should not
       be dropped into a blank message to type them again. */
    const ENDPOINT = 'https://script.google.com/macros/s/AKfycbz6PYpVX-t76SajpE2E1MTHrK9dpanwm812hUZSwPWaJeteZh1RbXcTjUlljmINyELFMA/exec';
    const ACCESS_TO = 'yash@origin.bio';

    /* The address is offered as something to click rather than opened, so nothing
       on this page ever launches mail on its own */
    const FAILED = 'That did not go through. Write to <a class="gate__link" href="mailto:' + ACCESS_TO + '">' + ACCESS_TO + '</a> and we will pick it up.';

    /* Enough to catch a typo without turning away an address a real mail server
       accepts */
    const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const status = form.querySelector('.gate__status');
    const send = form.querySelector('.gate__send');
    const fields = Array.from(form.querySelectorAll('input'));

    /* Which surface the visitor was on when they asked. Carried on the row rather
       than shown on the card, because which wall someone hit is worth knowing at
       our end and is not something the visitor needs telling. */
    let subject = 'Platform access';
    let opener = null;

    function say(text, bad, markup) {
        status.classList.toggle('is-bad', Boolean(bad));
        if (markup) status.innerHTML = text;
        else status.textContent = text;
    }

    function open(from) {
        subject = from || 'Platform access';

        if (gate.open) return;

        opener = document.activeElement;
        gate.showModal();
        fields[0].focus();
    }

    function close() {
        gate.close();
    }

    /* A missing field is marked where it is rather than listed at the bottom, and
       focus goes to the first thing that needs fixing. */
    function check() {
        let firstBad = null;

        fields.forEach(function (input) {
            const value = input.value.trim();
            const bad = !value || (input.type === 'email' && !EMAIL_SHAPE.test(value));
            input.parentElement.classList.toggle('is-bad', bad);
            if (bad && !firstBad) firstBad = input;
        });

        if (firstBad) {
            firstBad.focus();
            say('Every field is needed before we can get back to you.', true);
        }

        return !firstBad;
    }

    function row() {
        const out = { subject: subject, submitted_at: new Date().toISOString(), page: window.location.href };
        fields.forEach(function (input) { out[input.name] = input.value.trim(); });
        return out;
    }

    function post(details) {
        if (!ENDPOINT) return Promise.reject(new Error('no access endpoint configured'));

        return fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(details)
        }).then(function (response) {
            if (!response.ok) throw new Error('access request rejected with ' + response.status);
        });
    }

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!check()) return;

        const details = row();
        send.disabled = true;
        say('Sending\u2026');

        post(details).then(function () {
            form.reset();
            send.disabled = false;
            say('Thanks \u2014 we will be in touch at ' + details.email + '.');
        }).catch(function () {
            send.disabled = false;
            say(FAILED, true, true);
        });
    });

    /* Clear the mark as soon as the field it is on is being fixed */
    fields.forEach(function (input) {
        input.addEventListener('input', function () {
            input.parentElement.classList.remove('is-bad');
        });
    });

    document.addEventListener('click', function (event) {
        const opens = event.target.closest('[data-access]');
        if (opens) {
            event.preventDefault();
            open(opens.dataset.access);
            return;
        }

        if (event.target.closest('[data-access-close]')) close();
    });

    /* Clicking the backdrop closes it, which is the gesture everything else on
       this page already answers to. The card stops the click from reaching here. */
    gate.addEventListener('click', function (event) {
        if (event.target === gate) close();
    });

    /* Reset on the way out so a second visit is not looking at the last message */
    gate.addEventListener('close', function () {
        say('');
        fields.forEach(function (input) { input.parentElement.classList.remove('is-bad'); });
        if (opener) opener.focus();
    });

    /* The workspace in the hero asks from inside its frame, which cannot open a
       dialog on this page itself. It collects the same four fields behind its own
       gate, so when they arrive filled they are recorded rather than asked for a
       second time; the frame has already told the visitor it went. The card only
       opens if the request came without them, or if writing it down failed. */
    document.addEventListener('origin:access', function (event) {
        const detail = event.detail || {};
        const from = detail.tab ? 'Access \u2014 ' + detail.tab : '';

        if (!detail.email) {
            open(from);
            return;
        }

        subject = from || 'Platform access';

        const details = row();
        fields.forEach(function (input) { details[input.name] = detail[input.name] || ''; });

        post(details).catch(function () {
            fields.forEach(function (input) { input.value = details[input.name]; });
            open(from);
            say(FAILED, true, true);
        });
    });
})();
