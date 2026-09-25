"use strict";

const $ = (sel) => document.querySelector(sel);

/* -------------------------------------------------------------- progress */

function initProgress() {
  const bar = $("#progress");
  const tick = () => {
    const span = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = span > 0 ? `${Math.min(100, (window.scrollY / span) * 100)}%` : "0%";
  };
  tick();
  addEventListener("scroll", tick, { passive: true });
  addEventListener("resize", tick);
}

/* --------------------------------------------------------------- drawers */

function initDrawers() {
  const all = [...document.querySelectorAll("details")];
  const btn = $("#expandAll");
  if (!all.length || !btn) return;

  const allOpen = () => all.every((d) => d.open);
  const sync = () => {
    const open = allOpen();
    btn.textContent = open ? "Collapse all detail" : "Expand all detail";
    btn.setAttribute("aria-expanded", String(open));
  };
  const setAll = (open) => { all.forEach((d) => { d.open = open; }); sync(); };

  // MathJax measures from font metrics, but a drawer that has never been
  // painted can still mis-size a wide display equation on first reveal.
  all.forEach((d) => d.addEventListener("toggle", () => {
    if (d.open && !d.dataset.typeset && window.MathJax?.typesetPromise) {
      d.dataset.typeset = "1";
      window.MathJax.typesetPromise([d]).catch(() => {});
    }
    sync();
  }));

  btn.addEventListener("click", () => setAll(!allOpen()));

  // A link into a closed drawer should open it, so anchors inside the folded
  // sections keep working from the contents list and cross-references. This
  // runs only on in-page navigation: every drawer starts closed on load, even
  // when the URL still carries a hash from an earlier visit.
  const reveal = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && document.getElementById(id);
    if (!target) return;
    let changed = false;
    for (let d = target.closest("details"); d; d = d.parentElement?.closest("details")) {
      if (!d.open) { d.open = true; changed = true; }
    }
    if (changed) requestAnimationFrame(() => target.scrollIntoView({ behavior: "instant", block: "start" }));
  };
  addEventListener("hashchange", reveal);
  // Following a link to the hash already in the URL fires no hashchange, so a
  // drawer closed since the last visit to that anchor would otherwise stay shut.
  addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    if (a && a.hash === location.hash) requestAnimationFrame(reveal);
  });
  sync();

  let restore = null;
  addEventListener("beforeprint", () => {
    restore = all.map((d) => d.open);
    all.forEach((d) => { d.open = true; });
  });
  addEventListener("afterprint", () => {
    if (!restore) return;
    all.forEach((d, i) => { d.open = restore[i]; });
    restore = null;
    sync();
  });
}

/* ------------------------------------------------------------------- toc */

function initToc() {
  const links = [...document.querySelectorAll(".toc a")];
  const map = new Map();
  links.forEach((a) => {
    const el = document.querySelector(a.getAttribute("href"));
    if (el) map.set(el, a);
  });
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.remove("here"));
      map.get(e.target)?.classList.add("here");
    });
  }, { rootMargin: "-72px 0px -70% 0px", threshold: 0 });
  map.forEach((_, el) => obs.observe(el));
}

/* ------------------------------------------------------------------ boot */

initProgress();
initDrawers();
initToc();
