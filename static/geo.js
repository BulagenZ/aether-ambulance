/* AETHER map geometry: turns grid cells (row, col) into pixel positions on the map,
   so routes can be drawn as one smooth SVG line and the ambulance can follow it.
   Pure drawing helpers; no algorithm runs here. */
(() => {
  "use strict";

  /** Pixel centre of a cell, relative to the map element. */
  function center(mapEl, cell) {
    const el = mapEl.querySelector(`.cell[data-key="${cell[0]},${cell[1]}"]`);
    return [el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2];
  }

  /** Distance between the centres of two neighbouring cells. */
  function pitch(mapEl) {
    const a = mapEl.querySelector('.cell[data-key="0,0"]');
    const b = mapEl.querySelector('.cell[data-key="0,1"]');
    return b.offsetLeft - a.offsetLeft;
  }

  function cellSize(mapEl) {
    return mapEl.querySelector(".cell").offsetWidth;
  }

  /** Match the SVG coordinate system to the map's pixels. */
  function fitOverlay(mapEl, svg) {
    const w = mapEl.clientWidth, h = mapEl.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    return [w, h];
  }

  /**
   * SVG path through the given points with rounded corners of radius r.
   * Straight runs are merged; a U-turn is kept so the turn-back route reverses visibly.
   */
  function roundedPath(points, r) {
    if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : "";
    const pts = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = pts[pts.length - 1], b = points[i], c = points[i + 1];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (Math.abs(cross) > 1e-6 || dot < 0) pts.push(b);   // keep corners and U-turns
    }
    pts.push(points[points.length - 1]);

    const fmt = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l, l]; };
    let d = `M${fmt(pts[0])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const [ux, uy, l1] = unit(a, b);
      const [vx, vy, l2] = unit(b, c);
      const rr = Math.min(r, l1 / 2, l2 / 2);
      const p1 = [b[0] - ux * rr, b[1] - uy * rr];
      const p2 = [b[0] + vx * rr, b[1] + vy * rr];
      d += ` L${fmt(p1)} Q${fmt(b)} ${fmt(p2)}`;
    }
    return d + ` L${fmt(pts[pts.length - 1])}`;
  }

  /** Path string for a list of cells. */
  function routePath(mapEl, cells) {
    return roundedPath(cells.map((c) => center(mapEl, c)), pitch(mapEl) * 0.42);
  }

  window.AETHER_GEO = { center, pitch, cellSize, fitOverlay, roundedPath, routePath };
})();
