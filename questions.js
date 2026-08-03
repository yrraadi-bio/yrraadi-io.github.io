/* Types "What if", pauses, types the rest of the question, then clears and repeats. */
(function () {
    const el = document.getElementById('question');
    if (!el) return;

    const LEAD = 'What if';

    /* asterisks mark the words set in italic; they are stripped when the
       question is parsed and never reach the page */
    const QUESTIONS = [
        'What if we made as many cancer drugs next year as we have in the last *10*?',
        'What if every cancer drug that failed worked for *someone* else?',
        'What if we could see what a drug does *before* we spend a decade finding out?'
    ];

    const LEAD_TYPE = 105;  // per character in "What if"
    const REST_TYPE = 33;   // per character in the remainder
    const BEAT = 440;       // pause between the lead landing and the rest starting
    const HOLD = 2400;      // full question on screen
    const OUT = 700;        // fade out
    const GAP = 320;        // blank beat before the next question types

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
        schedule(next, OUT);
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

/* The bar overlaps the stage, so it gets out of the way on the way down and comes
   back on the way up.

   It used to leave at 60px and return only at the very top, which left twenty-six
   thousand pixels of page with no way home and no navigation on it at all. Coming
   back on a reverse is the one gesture that means "I want out of this" without
   costing the page a control that is on screen the whole time. */
(function () {
    const dock = document.querySelector('.dock');
    if (!dock) return;

    const HOME = 60;    /* under this the bar belongs to the hero and is always up */
    const REVEAL = 60;  /* upward travel that brings it back */

    let last = window.scrollY;
    let climbed = 0;
    let queued = false;

    function show(afloat) {
        dock.classList.remove('is-gone');
        dock.classList.toggle('is-afloat', afloat);
    }

    function sync() {
        queued = false;
        const y = Math.max(0, window.scrollY);
        const step = y - last;
        last = y;

        if (y <= HOME) {
            climbed = 0;
            show(false);
            return;
        }

        /* Any downward travel puts it away and forgets what was climbed, so the
           reveal is a deliberate reverse rather than the tail of a flick */
        if (step > 0) {
            climbed = 0;
            dock.classList.add('is-gone');
            return;
        }

        if (step < 0) {
            climbed -= step;
            if (climbed > REVEAL) show(true);
        }
    }

    window.addEventListener('scroll', function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(sync);
    }, { passive: true });

    sync();
})();
