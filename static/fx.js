/* AETHER interface motion (Motion.dev).
   Small UI effects: counters, springs, reveals, page transitions, the sidebar indicator.
   Every helper has an `instant` path, and everything is skipped when Motion is missing or
   the viewer prefers reduced motion, so the page always ends in the same final state. */
(() => {
  "use strict";

  const M = window.Motion;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const enabled = !!M && !reduced;
  const EASE = [0.22, 1, 0.36, 1];
  const running = new Set();
  const toArray = (x) => (!x ? [] : x instanceof Element ? [x] : [...x]);

  function track(controls) {
    if (!controls) return controls;
    running.add(controls);
    Promise.resolve(controls.finished || controls).then(() => running.delete(controls), () => running.delete(controls));
    return controls;
  }
  const animate = (...args) => track(M.animate(...args));

  const fx = {
    enabled,

    /** Stop every running interface animation (used when a run is reset). */
    stopAll() {
      running.forEach((c) => { try { c.stop(); } catch { /* already finished */ } });
      running.clear();
    },

    /** Count the number shown in `el` up to `to`. The final text is always exactly fmt(to). */
    count(el, to, { from = 0, fmt = (v) => v.toFixed(2), duration = 0.8, delay = 0, instant = false } = {}) {
      if (!el) return;
      if (!enabled || instant) { el.textContent = fmt(to); return; }
      el.textContent = fmt(from);
      animate(from, to, {
        duration, delay, ease: EASE,
        onUpdate: (v) => { el.textContent = fmt(v); },
        onComplete: () => { el.textContent = fmt(to); },
      });
    },

    /** Spring an element into view. */
    pop(el, { delay = 0, instant = false, from = 0.85 } = {}) {
      if (!el) return;
      if (!enabled || instant) { el.style.opacity = ""; el.style.transform = ""; return; }
      if (delay) el.style.opacity = "0";      // stay hidden until the pop starts
      animate(el, { opacity: [0, 1], scale: [from, 1] }, { type: "spring", stiffness: 380, damping: 22, delay });
    },

    /** Fade and slide a group of elements in, one after another. */
    reveal(els, { y = 10, delay = 0, gap = 0.05, duration = 0.4, instant = false } = {}) {
      els = toArray(els);
      if (!els.length || !enabled || instant) return;
      animate(els, { opacity: [0, 1], y: [y, 0] }, { duration, ease: EASE, delay: M.stagger(gap, { startDelay: delay }) });
    },

    /** Animate a bar's width to `pct` percent. */
    width(el, pct, { delay = 0, instant = false } = {}) {
      if (!el) return;
      if (!enabled || instant) { el.style.width = pct + "%"; return; }
      animate(el, { width: pct + "%" }, { type: "spring", stiffness: 110, damping: 20, delay });
    },

    /** Grow several bars in sequence. widths: array of percentages, same order as els. */
    widths(els, widths, { delay = 0, gap = 0.08, instant = false } = {}) {
      toArray(els).forEach((el, i) => fx.width(el, widths[i], { delay: delay + i * gap, instant }));
    },

    shake(el) {
      if (!el || !enabled) return;
      animate(el, { x: [0, -8, 8, -6, 6, -3, 0] }, { duration: 0.5, ease: "easeOut" });
    },

    pulse(el, { scale = 1.05, delay = 0 } = {}) {
      if (!el || !enabled) return;
      animate(el, { scale: [1, scale, 1] }, { duration: 0.45, delay, ease: "easeInOut" });
    },

    /** A ring that spreads from the centre of `el` (used when a map cell is clicked). */
    ripple(el) {
      if (!el || !enabled) return;
      const ring = document.createElement("span");
      ring.className = "ripple";
      el.appendChild(ring);
      animate(ring, { scale: [0.2, 1.6], opacity: [0.7, 0] }, { duration: 0.55, ease: EASE })
        .then(() => ring.remove(), () => ring.remove());
    },

    /** Page transition: the view slides up and its cards follow one by one. */
    pageIn(view) {
      if (!view || !enabled) return;
      animate(view, { opacity: [0, 1], y: [8, 0] }, { duration: 0.3, ease: EASE });
      const cards = [...view.querySelectorAll(":scope > .card, :scope > .callout, :scope > div > .card, :scope > div > article")].slice(0, 10);
      fx.reveal(cards, { y: 14, delay: 0.05, gap: 0.045 });
    },

    /** Move the sidebar highlight behind the active item. */
    moveIndicator(indicator, target, { instant = false } = {}) {
      if (!indicator || !target) return;
      const box = { left: target.offsetLeft + "px", top: target.offsetTop + "px", width: target.offsetWidth + "px", height: target.offsetHeight + "px" };
      indicator.style.opacity = "1";
      if (!enabled || instant) { Object.assign(indicator.style, box); return; }
      animate(indicator, box, { type: "spring", stiffness: 420, damping: 34 });
    },

    /** Small press feedback on buttons. */
    pressable(selector) {
      if (!enabled) return;
      M.press(selector, (el) => {
        M.animate(el, { scale: 0.95 }, { type: "spring", stiffness: 700, damping: 30 });
        return () => M.animate(el, { scale: 1 }, { type: "spring", stiffness: 500, damping: 14 });
      });
    },

    /** Run `callback` once, the first time `el` scrolls into view. */
    onceInView(el, callback, { amount = 0.15 } = {}) {
      if (!el) return;
      if (!enabled) { callback(true); return; }
      let done = false;
      const stop = M.inView(el, () => {
        if (done) return;
        done = true;
        callback(false);
        if (typeof stop === "function") setTimeout(stop, 0);
      }, { amount });
    },
  };

  window.AETHER_FX = fx;
})();
