/* Types "What if", pauses, types the rest of the question, then clears and repeats. */
(function () {
    const el = document.getElementById('question');
    if (!el) return;

    const LEAD = 'What if';

    /* asterisks mark the words set in italic; they are stripped when the
       question is parsed and never reach the page */
    const QUESTIONS = [
        'What if we made as many cancer drugs next year as we have in the last *100*?',
        'What if every cancer drug that failed worked for *someone* else?',
        'What if we could see what a drug does *before* we spend a decade finding out?'
    ];

    const LEAD_TYPE = 105;  // per character in "What if"
    const REST_TYPE = 33;   // per character in the remainder
    const BEAT = 440;       // pause between the lead landing and the rest starting
    const HOLD = 2400;      // full question on screen
    const OUT = 700;        // fade out
    const GAP = 320;        // blank beat before the next question types

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const lead = el.querySelector('.q__lead');
    const rest = el.querySelector('.q__rest');
    if (!lead || !rest) return;
    lead.textContent = '';
    rest.textContent = '';

    /* Each question becomes a run of plain and italic pieces, with the lead the
       page already holds taken off the front, so typing can count characters
       across the whole tail without caring which piece they land in. */
    const TAILS = QUESTIONS.map(function (question) {
        let taken = 0;
        const pieces = [];
        question.split('*').forEach(function (chunk, i) {
            let text = chunk;
            if (taken < LEAD.length) {
                text = text.slice(LEAD.length - taken);
                taken += chunk.length;
            }
            if (text) pieces.push({ text: text, em: i % 2 === 1 });
        });
        return {
            pieces: pieces,
            length: pieces.reduce(function (n, p) { return n + p.text.length; }, 0)
        };
    });

    let index = 0;
    let visible = true;
    let timer = null;

    function schedule(fn, ms) {
        clearTimeout(timer);
        timer = setTimeout(fn, ms);
    }

    function tail() {
        return TAILS[index];
    }

    function paint(count) {
        const pieces = tail().pieces;
        rest.textContent = '';
        let left = count;
        for (let i = 0; i < pieces.length && left > 0; i++) {
            const text = pieces[i].text.slice(0, left);
            left -= text.length;
            if (!pieces[i].em) {
                rest.appendChild(document.createTextNode(text));
                continue;
            }
            const em = document.createElement('em');
            em.textContent = text;
            rest.appendChild(em);
        }
    }

    function typeLead(i) {
        lead.textContent = LEAD.slice(0, i);
        if (i < LEAD.length) return schedule(() => typeLead(i + 1), LEAD_TYPE);
        el.classList.remove('is-typing-lead');
        schedule(startRest, BEAT);
    }

    function startRest() {
        el.classList.add('is-typing-rest');
        typeRest(1);
    }

    function typeRest(i) {
        paint(i);
        if (i < tail().length) return schedule(() => typeRest(i + 1), REST_TYPE);
        el.classList.remove('is-typing-rest');
        schedule(hide, HOLD);
    }

    function hide() {
        // pause the cycle while the hero is off screen so a returning visitor
        // always lands on a whole question rather than mid-transition
        if (!visible) return schedule(hide, 600);
        el.classList.remove('is-live');
        el.classList.add('is-out');
        schedule(next, reduceMotion ? 60 : OUT);
    }

    function next() {
        index = (index + 1) % QUESTIONS.length;
        lead.textContent = '';
        rest.textContent = '';
        el.classList.remove('is-out');
        schedule(start, GAP);
    }

    function start() {
        // is-live drops the transition on the tail so typed characters land
        // crisply instead of each one fading up
        el.classList.add('is-live');
        if (reduceMotion) {
            lead.textContent = LEAD;
            paint(tail().length);
            return schedule(hide, HOLD);
        }
        el.classList.add('is-typing-lead');
        typeLead(1);
    }

    if ('IntersectionObserver' in window) {
        new IntersectionObserver(entries => {
            visible = entries[0].isIntersecting;
        }, { threshold: 0.15 }).observe(el);
    }

    start();
})();

/* The pivot question types itself out the first time it is scrolled to. */
(function () {
    const el = document.getElementById('pivotLine');
    if (!el) return;

    const text = el.textContent.trim();
    const TYPE = 52;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || !('IntersectionObserver' in window)) return;

    el.textContent = '';

    function type(i) {
        el.textContent = text.slice(0, i);
        if (i < text.length) return setTimeout(() => type(i + 1), TYPE);
        el.classList.remove('is-typing');
    }

    const watch = new IntersectionObserver(entries => {
        if (!entries[0].isIntersecting) return;
        watch.disconnect();
        el.classList.add('is-typing');
        type(1);
    }, { threshold: 0.6 });

    watch.observe(el);
})();

/* The bar overlaps the stage once the page moves, so it only shows at the top. */
(function () {
    const dock = document.querySelector('.dock');
    if (!dock) return;

    let queued = false;

    function sync() {
        queued = false;
        dock.classList.toggle('is-gone', window.scrollY > 60);
    }

    window.addEventListener('scroll', function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(sync);
    }, { passive: true });

    sync();
})();
