/* AETHER dashboard.
   This file only draws. Every number shown is returned by the Python backend
   (/api/config, /api/simulate, /api/evaluate). No result is computed here.

   Animation:
   - Anime.js plays one timeline per run (map search, route drawing, ambulance, Viterbi
     trellis, Bayes bar). The timeline can be paused, stepped stage by stage, sped up or
     skipped. The final state of every stage is applied by "events", so jumping anywhere
     always shows exactly the same result.
   - Motion (via fx.js) adds interface feel: counters, springs, page transitions.
   - Without the libraries, or with reduced motion, the result is shown immediately. */
(() => {
  "use strict";

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const FX = window.AETHER_FX;
  const GEO = window.AETHER_GEO;
  const A = window.anime || null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ANIMATED = !!A && !reducedMotion;
  const setProps = A && ((A.utils && A.utils.set) || A.set);
  const f = (x, d = 2) => Number(x).toFixed(d);
  const num = (x) => String(+Number(x).toFixed(4));          // 0.3600 -> "0.36"
  const key = (cell) => cell[0] + "," + cell[1];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

  const VIEWS = {
    dashboard: ["Dashboard", "Run a scenario and watch the five stages decide the route."],
    algorithms: ["Algorithms", "What each algorithm does, how it works and why it fits."],
    flow: ["Data flow", "Each stage's output becomes the next stage's input."],
    results: ["Results", "Testing and evaluation, computed by the Python backend."],
    assumptions: ["Assumptions", "The invented values behind the simulation."],
    about: ["Project info", "The problem, the scope and the limits of this project."],
  };

  const STAGES = [
    { id: "astar", title: "A* search", sub: "Fastest route to the hospital" },
    { id: "viterbi", title: "HMM · Viterbi", sub: "What is the traffic doing on the risky road?" },
    { id: "bayes", title: "Bayes' rule", sub: "Is the road actually blocked?" },
    { id: "mdp", title: "MDP", sub: "Continue on the fast road, or reroute now?" },
    { id: "final", title: "A* re-plan", sub: "Final route" },
  ];

  const state = {
    config: null,
    scenario: "rush",        // preset key or "custom"
    speeds: [],
    alert: false,
    result: null,
    player: null,
    fetching: false,
    speed: 1,
    stepMode: false,
    compareBfs: false,
    flow: null,              // data-flow page animation
    view: "dashboard",
  };

  /* ================================================================ backend */
  async function api(path, options) {
    let response;
    try {
      response = await fetch(path, options);
    } catch {
      throw new Error("Cannot reach the Python backend. Check that app.py is still running, then try again.");
    }
    let data = null;
    try { data = await response.json(); } catch { /* not JSON */ }
    if (!response.ok) throw new Error((data && data.error) || `The server returned an error (${response.status}).`);
    if (data === null) throw new Error("The server sent an unreadable response.");
    return data;
  }

  function setStatus(kind, text) {
    $("#status").dataset.state = kind;
    $("#status-text").textContent = text;
  }
  function showError(message) {
    $("#error-text").textContent = message;
    const banner = $("#error-banner");
    banner.hidden = false;
    FX.shake(banner);
    setStatus("error", "Error");
  }
  function clearError() { $("#error-banner").hidden = true; }

  /* ================================================================ navigation */
  function showView(name, { instant = false } = {}) {
    if (!VIEWS[name]) name = "dashboard";
    const view = $("#view-" + name);
    const changed = state.view !== name;
    state.view = name;
    $$(".view").forEach((v) => v.classList.toggle("active", v === view));
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    FX.moveIndicator($("#nav-indicator"), $(`.nav-item[data-view="${name}"]`), { instant });
    $("#view-title").textContent = VIEWS[name][0];
    $("#view-sub").textContent = VIEWS[name][1];
    if (location.hash.slice(1) !== name) history.replaceState(null, "", "#" + name);
    if (changed) window.scrollTo(0, 0);
    if (changed && !instant) FX.pageIn(view);
    if (name === "dashboard") ensureLayout();
    flowLoop(name === "flow");
  }

  /* ================================================================ controls */
  function buildControls() {
    const cfg = state.config;
    const picker = $("#scenario-picker");
    picker.innerHTML = "";
    [...cfg.scenarios, { key: "custom", title: "Custom" }].forEach((sc) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.key = sc.key;
      b.textContent = sc.title;
      b.addEventListener("click", () => selectScenario(sc.key));
      picker.appendChild(b);
    });

    const row = $("#speed-toggles");
    row.innerHTML = "";
    for (let i = 0; i < cfg.n_reports; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip-toggle";
      b.addEventListener("click", () => {
        state.speeds[i] = state.speeds[i] === "fast" ? "slow" : "fast";
        state.scenario = "custom";
        syncControls();
      });
      row.appendChild(b);
    }
    $("#alert-toggle").addEventListener("click", () => {
      state.alert = !state.alert;
      state.scenario = "custom";
      syncControls();
    });
    selectScenario("rush");
  }

  function selectScenario(k) {
    const preset = state.config.scenarios.find((s) => s.key === k);
    if (preset) {
      state.speeds = [...preset.speeds];
      state.alert = preset.alert;
    } else if (!state.speeds.length) {
      state.speeds = Array(state.config.n_reports).fill("fast");
    }
    state.scenario = preset ? k : "custom";
    syncControls();
  }

  function syncControls() {
    $$("#scenario-picker button").forEach((b) =>
      b.setAttribute("aria-checked", String(b.dataset.key === state.scenario)));
    $$("#speed-toggles button").forEach((b, i) => {
      b.dataset.value = state.speeds[i];
      b.textContent = state.speeds[i] === "fast" ? "Fast" : "Slow";
      b.setAttribute("aria-label", `Speed report ${i + 1}: ${state.speeds[i]}. Click to change.`);
    });
    const t = $("#alert-toggle");
    t.setAttribute("aria-pressed", String(state.alert));
    t.textContent = state.alert ? "Alert raised" : "No alert";
  }

  /* ================================================================ map */
  // Top-down ambulance facing right (0°), so it can turn to follow the route.
  const VEHICLE_SVG =
    '<svg viewBox="0 0 40 24" aria-hidden="true">' +
    '<rect x="1" y="2" width="37" height="20" rx="5" fill="#f4f7fb" stroke="#0a0e15" stroke-width="1"/>' +
    '<rect x="28" y="4" width="7.5" height="16" rx="3" fill="#1b2a3d"/>' +
    '<path d="M7 12h9M11.5 7.5v9" stroke="#ff4f64" stroke-width="3" stroke-linecap="round"/>' +
    '<rect class="siren-r" x="20" y="4" width="4.5" height="7.5" rx="1.5" fill="#ff4f64"/>' +
    '<rect class="siren-b" x="20" y="12.5" width="4.5" height="7.5" rx="1.5" fill="#3fa9ff"/></svg>';

  function buildMap() {
    const { grid, risky_road } = state.config;
    const map = $("#map");
    map.innerHTML = "";
    grid.forEach((row, r) => [...row].forEach((ch, c) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.key = r + "," + c;
      cell.dataset.kind = ch === "#" ? "wall" : ch === "S" ? "start" : ch === "H" ? "goal" : "road";
      if (r === risky_road[0] && c === risky_road[1]) cell.dataset.kind = "risky";
      cell.innerHTML = '<span class="xd"></span><span class="xp"></span><span class="xb"></span><span class="glyph"></span><span class="step"></span>';
      cell.addEventListener("click", () => { FX.ripple(cell); inspectCell(cell, r, c); });
      map.appendChild(cell);
    }));
    map.insertAdjacentHTML("beforeend",
      '<svg class="map-svg" id="map-svg" aria-hidden="true">' +
      '<path id="route-ghost" class="route-line ghost"/><path id="route-fast" class="route-line fast"/>' +
      '<path id="route-detour" class="route-line detour"/></svg>' +
      `<div class="vehicle ghost" id="ghost">${VEHICLE_SVG}</div><div class="vehicle" id="ambulance">${VEHICLE_SVG}</div>`);
    resetMap();
  }

  function cellEl(cell) { return $(`.cell[data-key="${key(cell)}"]`); }

  function sizeVehicles() {
    const map = $("#map");
    const w = GEO.cellSize(map) * 0.74, h = w * 0.6;
    $$(".vehicle", map).forEach((v) => Object.assign(v.style, {
      width: w + "px", height: h + "px", marginLeft: -w / 2 + "px", marginTop: -h / 2 + "px",
    }));
    map.style.setProperty("--lw", Math.max(4, GEO.pitch(map) * 0.13).toFixed(1) + "px");
  }

  function setPose(el, cell, towards) {
    const map = $("#map");
    const [x, y] = GEO.center(map, cell);
    let deg = 0;
    if (towards) {
      const [x2, y2] = GEO.center(map, towards);
      deg = Math.atan2(y2 - y, x2 - x) * 180 / Math.PI;
    }
    if (setProps) setProps(el, { translateX: x, translateY: y, rotate: deg });
    else el.style.transform = `translate(${x}px, ${y}px) rotate(${deg}deg)`;
  }

  function resetMap() {
    const map = $("#map");
    map.classList.remove("search-done");
    $$(".cell", map).forEach((el) => {
      const kind = el.dataset.kind;
      el.className = "cell" + (kind !== "road" ? " " + kind : "");
      el.removeAttribute("style");
      $(".glyph", el).textContent = kind === "goal" ? "H" : kind === "risky" ? "?" : "";
      ["step", "xp", "xb", "xd"].forEach((c) => { const s = $("." + c, el); s.textContent = ""; s.removeAttribute("style"); });
    });
    $$(".route-line", map).forEach((p) => { p.setAttribute("d", ""); p.removeAttribute("style"); p.classList.remove("show", "abandoned"); });
    const ghost = $("#ghost"), amb = $("#ambulance");
    ghost.classList.remove("show", "driving");
    amb.classList.remove("driving");
    if (state.config) {
      sizeVehicles();
      setPose(amb, state.config.start, [state.config.start[0] + 1, state.config.start[1]]);
      setPose(ghost, state.config.start, [state.config.start[0] + 1, state.config.start[1]]);
    }
    $("#cell-info").textContent = "Click any cell to inspect it.";
    $("#map-stats").innerHTML = "Press <b>Run simulation</b> to watch A* search the map.";
  }

  function setSteps(path, instant) {
    $$("#map .step").forEach((s) => (s.textContent = ""));
    const els = [];
    path.forEach((c, i) => {
      if (i === 0 || i === path.length - 1) return;
      const s = $(".step", cellEl(c));
      s.textContent = i;
      els.push(s);
    });
    FX.reveal(els, { y: 4, gap: 0.03, duration: 0.25, instant });
  }

  function mapStats() {
    const d = state.result, p = state.player;
    if (!d || !p) return;
    const fl = p.flags, a = d.astar;
    const bfs = state.compareBfs ? ` · BFS: <b>${fl.bfsCount}</b> cells` : "";
    let html;
    if (fl.drive) {
      html = fl.rerouted
        ? `Ambulance on the detour: minute <b>${fl.minuteAmb}</b> of ${d.final.minutes} · ghost turning back: minute <b>${fl.minuteGhost}</b> of ${a.backtrack_minutes}`
        : `Ambulance on the fast road: minute <b>${fl.minuteAmb}</b> of ${d.final.minutes}`;
      if (fl.arrived) html = fl.rerouted
        ? `Arrived after <b>${d.final.minutes}</b> minutes. Driving in and turning back would have taken <b>${a.backtrack_minutes}</b>.`
        : `Arrived after <b>${d.final.minutes}</b> minutes on the fast road.`;
    } else if (fl.replanning) {
      html = `A* re-plans with the risky road closed: <b>${a.detour_expanded}</b> cells expanded, detour <b>${a.detour_minutes}</b> minutes.`;
    } else if (fl.fastRoute) {
      html = `A* found the <b>${a.minutes}</b>-minute route after expanding <b>${a.expanded}</b> cells` +
        (state.compareBfs ? ` · BFS needed <b>${a.bfs_expanded}</b>.` : `. BFS would need ${a.bfs_expanded} (try “Compare with BFS”).`);
    } else {
      html = `A* is searching: <b>${fl.astarCount}</b> of ${a.expanded} cells expanded${bfs}. Each cell shows f = g + h.`;
    }
    $("#map-stats").innerHTML = html;
  }

  function inspectCell(el, r, c) {
    $$(".cell.selected").forEach((x) => x.classList.remove("selected"));
    el.classList.add("selected");
    const names = {
      wall: "Permanently closed. A* never enters it.",
      start: "Ambulance start.",
      goal: "Hospital (the goal).",
      road: "Free road.",
      risky: el.classList.contains("blocked")
        ? "Risky road, treated as blocked for the re-plan."
        : "Risky road under the bridge. It may be blocked.",
    };
    let text = `<b>Row ${r}, column ${c}.</b> ${names[el.dataset.kind]}`;
    const d = state.result, fl = state.player ? state.player.flags : null;
    if (d && fl) {
      const here = [r, c];
      const i = d.astar.search.findIndex((e) => same(e.cell, here));
      if (i >= 0 && i < fl.astarCount) {
        const e = d.astar.search[i];
        text += ` A* expanded it ${ordinal(i + 1)}: f = g + h = ${e.g} + ${e.h} = ${e.f}.`;
      }
      const j = d.astar.bfs_search.findIndex((x) => same(x, here));
      if (j >= 0 && j < fl.bfsCount) text += ` BFS expanded it ${ordinal(j + 1)}.`;
      const route = fl.rerouted ? d.final.path : fl.fastRoute ? d.astar.path : null;
      const k = route ? route.findIndex((x) => same(x, here)) : -1;
      if (k > 0) text += ` Minute ${k} of the ${fl.rerouted ? "detour" : "fast route"}.`;
      else if (fl.rerouted && d.astar.path.some((x) => same(x, here)) && k < 0) text += " Part of the abandoned fast route.";
    }
    $("#cell-info").innerHTML = text;
  }

  /* ================================================================ stage cards */
  function buildStages() {
    $("#stages").innerHTML = STAGES.map((s, i) => `
      <li class="stage" id="stage-${s.id}">
        <div class="stage-head">
          <span class="num">${i + 1}</span>
          <div><div class="stage-title">${s.title}</div><div class="muted">${s.sub}</div></div>
          <span class="stage-state">Waiting</span>
        </div>
        <div class="stage-body"></div>
      </li>`).join("");
  }

  function setStage(id, cls, html) {
    const el = $("#stage-" + id);
    el.classList.remove("active", "done");
    if (cls) el.classList.add(cls);
    $(".stage-state", el).textContent = cls === "active" ? "Running" : cls === "done" ? "Done" : "Waiting";
    if (html !== undefined) $(".stage-body", el).innerHTML = html;
  }

  const kv = (rows) => `<dl class="kv">${rows.map(([k, v, cls]) =>
    `<dt>${k}</dt><dd class="${cls || ""}">${v}</dd>`).join("")}</dl>`;
  const calc = (lines) => `<div class="calc">${lines.map((l) => `<div>${l}</div>`).join("")}</div>`;
  const pills = (items) => items.map((s) => `<span class="pill ${s}">${s}</span>`).join('<span class="arrow">→</span>');

  function stageAstar(d) {
    const a = d.astar, c = state.config;
    return kv([
      ["Input", `6×6 grid, start (${c.start}), hospital (${c.goal}), 1 move = 1 minute`],
      ["Steps", calc([
        "expand the cell with the lowest f = g (minutes so far) + h (Manhattan distance)",
        `cells expanded: <span class="hl">${a.expanded}</span> (BFS on the same map needs ${a.bfs_expanded}) — watch the map`,
        `second search with the risky road closed: detour = <span class="hl">${a.detour_minutes}</span> min`,
        `third search from (${a.turn_cell}) after ${a.minutes_to_turn} min: drive in and turn back = <span class="hl">${a.backtrack_minutes}</span> min`,
      ])],
      ["Output", `Fastest route: ${a.minutes} minutes. It ${a.uses_risky ? "passes through" : "avoids"} the risky road (${c.risky_road}).`, "out"],
      ["Why", "A* is optimal here and looks at fewer cells than BFS because the heuristic points it at the hospital.", "why"],
    ]);
  }

  function trellisSVG(v, states) {
    const xs = [118, 238, 358], ys = { [states[0]]: 64, [states[1]]: 136 }, r = 25;
    let s = `<svg class="trellis" id="trellis" viewBox="0 0 420 172" role="img" aria-label="Viterbi trellis. Most likely sequence: ${v.path.join(", ")}">`;
    v.observations.forEach((o, t) => { s += `<text class="tr-head" x="${xs[t]}" y="20" text-anchor="middle">t=${t + 1} · ${o}</text>`; });
    states.forEach((st) => { s += `<text class="tr-state" x="6" y="${ys[st] + 4}">${st}</text>`; });
    for (let t = 0; t < v.observations.length - 1; t++) {
      for (const p of states) for (const q of states) {
        s += `<line class="tr-edge" data-col="${t}" x1="${xs[t] + r}" y1="${ys[p]}" x2="${xs[t + 1] - r}" y2="${ys[q]}"/>`;
      }
    }
    // best path, drawn backwards (that is how Viterbi recovers it)
    for (let t = v.observations.length - 2; t >= 0; t--) {
      s += `<line class="tr-best" data-col="${t}" x1="${xs[t + 1] - r}" y1="${ys[v.path[t + 1]]}" x2="${xs[t] + r}" y2="${ys[v.path[t]]}"/>`;
    }
    v.table.forEach((row, t) => states.forEach((st) => {
      s += `<g transform="translate(${xs[t]},${ys[st]})"><g class="tr-node${v.path[t] === st ? " on-path" : ""}" data-col="${t}">` +
        `<circle r="${r}"/><text>${f(row[st], 4)}</text></g></g>`;
    }));
    return s + "</svg>";
  }

  function stageViterbi(d) {
    const v = d.viterbi, states = state.config.hmm.states;
    const rows = v.table.map((row, t) => {
      const best = states.reduce((a, b) => (row[a] >= row[b] ? a : b));
      return `<tr><td>t=${t + 1}</td><td>${v.observations[t]}</td>${states.map((s) =>
        `<td class="n ${s === best ? "best" : ""}">${f(row[s], 5)}</td>`).join("")}</tr>`;
    }).join("");
    return kv([
      ["Input", `Last three speed reports: ${pills(v.observations)}`],
      ["Steps", `${trellisSVG(v, states)}
        <div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Report</th>${states.map((s) =>
        `<th class="n">${s}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
        <div class="fine">Each number is the probability of the best state sequence ending in that state. The highlighted path is recovered backwards from the best final state.</div>`],
      ["Output", `Most likely sequence: ${pills(v.path)} <span class="muted mono">(probability ${f(v.probability, 5)})</span><br>
        Traffic now = ${v.traffic_now} → prior P(Blocked) = ${v.prior}`, "out"],
      ["Why", "The traffic state is hidden and changes over time. Viterbi finds the best explanation of the reports.", "why"],
    ]);
  }

  function bayesViz(d) {
    const obs = d.bayes.alert ? "alert" : "no alert";
    return `<div class="bayes-viz" id="bayes-viz">
      <ol class="bv-steps"><li>1 · Prior</li><li>2 · × P(${obs} | state)</li><li>3 · ÷ P(${obs})</li></ol>
      <div class="bv-bar" role="img" aria-label="Probability of Blocked versus Clear">
        <div class="bv-seg b" id="bv-b"></div><div class="bv-seg c" id="bv-c"></div></div>
      <div class="bv-legend"><span class="b">Blocked <b id="bv-bv">—</b></span><span class="c">Clear <b id="bv-cv">—</b></span><span class="lost" id="bv-lost"></span></div>
      <div class="bv-caption" id="bv-cap"></div></div>`;
  }

  function stageBayes(d) {
    const b = d.bayes, s = b.steps, obs = b.alert ? "alert" : "no alert", sen = state.config.sensor;
    return kv([
      ["Input", `Prior P(Blocked) = ${b.prior} (from stage 2). Sensor says: <b>${obs}</b>.
        P(alert | Blocked) = ${sen.p_alert_if_blocked}, P(alert | Clear) = ${sen.p_alert_if_clear}`],
      ["Steps", bayesViz(d) + calc([
        `P(${obs} | Blocked) × P(Blocked) = ${f(s.like_blocked)} × ${f(b.prior)} = <span class="hl">${f(s.joint_blocked, 4)}</span>`,
        `P(${obs} | Clear) &nbsp;&nbsp;× P(Clear) &nbsp;&nbsp;= ${f(s.like_clear)} × ${f(1 - b.prior)} = <span class="hl">${f(s.joint_clear, 4)}</span>`,
        `P(${obs}) = ${f(s.joint_blocked, 4)} + ${f(s.joint_clear, 4)} = ${f(s.evidence, 4)}`,
      ])],
      ["Output", `P(Blocked | ${obs}) = ${f(s.joint_blocked, 4)} / ${f(s.evidence, 4)} = ${f(b.posterior, 3)}`, "out"],
      ["Why", "The sensor is noisy, so one reading should shift the belief, not replace it.", "why"],
    ]);
  }

  function bayesPhase(i, d, instant) {
    const b = d.bayes, s = b.steps, obs = b.alert ? "alert" : "no alert";
    const vals = [[b.prior, 1 - b.prior], [s.joint_blocked, s.joint_clear], [b.posterior, 1 - b.posterior]][i];
    $("#bv-bv").textContent = i === 2 ? f(vals[0], 3) : num(vals[0]);
    $("#bv-cv").textContent = i === 2 ? f(vals[1], 3) : num(vals[1]);
    $("#bv-lost").textContent = i === 1 ? `striped: ${num(1 - s.evidence)} ruled out by the reading` : "";
    $("#bv-cap").innerHTML = [
      `Start from the prior of stage 2: P(Blocked) = ${num(b.prior)}.`,
      `Multiply by how likely “${obs}” is in each case: ${num(s.like_blocked)} × ${num(b.prior)} = <b>${num(s.joint_blocked)}</b> and ${num(s.like_clear)} × ${num(1 - b.prior)} = <b>${num(s.joint_clear)}</b>. Together P(${obs}) = ${num(s.evidence)}.`,
      `Divide by ${num(s.evidence)} so the two add up to 1: P(Blocked | ${obs}) = <b>${f(b.posterior, 3)}</b>.`,
    ][i];
    $$("#bayes-viz .bv-steps li").forEach((li, k) => li.classList.toggle("on", k === i));
    if (!ANIMATED) {        // no timeline: set the bar directly
      $("#bv-b").style.width = vals[0] * 100 + "%";
      $("#bv-c").style.width = vals[1] * 100 + "%";
    }
    FX.reveal($("#bv-cap"), { y: 4, instant });
  }

  function stageMdp(d) {
    const m = d.mdp, { states, actions, road_dynamics: dyn } = state.config.mdp;
    const table = (title, get, digits) => `<div class="table-wrap"><table class="table"><thead><tr><th>${title}</th>${states.map((s) =>
      `<th class="n">${s}</th>`).join("")}</tr></thead><tbody>${actions.map((a) =>
      `<tr><td>${a}</td>${states.map((s) => `<td class="n">${f(get(a, s), digits)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    return kv([
      ["Input", `${table("Reward (−minutes) if road is", (a, s) => m.rewards[a][s], 0)}
        <div class="fine">Rewards come from the A* routes in stage 1. The road may change before arrival:
        stays the same ${dyn.Clear.Clear}, flips ${dyn.Clear.Blocked}.</div>`],
      ["Steps", `${table("Q(s, a) after one Bellman update", (a, s) => m.q[s][a], 2)}` + calc([
        `weight by belief from stage 3: P(Blocked) = ${f(m.belief.Blocked, 3)}`,
        ...actions.map((a) => `expected value of ${a} = ${f(m.belief.Clear, 3)} × ${f(m.q.Clear[a])} + ${f(m.belief.Blocked, 3)} × ${f(m.q.Blocked[a])} = <span class="hl">${f(m.expected[a])}</span>`),
      ])],
      ["Output", `Best action: ${m.action.toUpperCase()}` + (m.threshold === null ? "" :
        ` <span class="muted">(Reroute wins once P(Blocked) is above ${f(m.threshold)})</span>`), "out"],
      ["Why", "Driving on has an uncertain outcome, so the agent compares expected rewards, not best cases.", "why"],
    ]);
  }

  function stageFinal(d) {
    const fin = d.final, a = d.astar;
    return kv([
      ["Input", `Decision from stage 4: <b>${fin.action}</b>`],
      ["Steps", fin.rerouted
        ? `A* searches again with the risky road closed (${a.detour_expanded} cells, shaded purple) and returns the detour.
           The grey ghost shows the alternative: drive in, find the road blocked and turn back (${a.backtrack_minutes} min).`
        : "No new search is needed. The original A* route is kept."],
      ["Output", `${fin.action.toUpperCase()} — planned travel time ${fin.minutes} minutes.`, "out"],
      ["Why", fin.rerouted
        ? "Re-planning turns the decision into a concrete route the driver can follow."
        : "The blockage risk is too low to justify ten extra minutes.", "why"],
    ]);
  }

  function renderStageBodies(d) {
    setStage("astar", "", stageAstar(d));
    setStage("viterbi", "", stageViterbi(d));
    setStage("bayes", "", stageBayes(d));
    setStage("mdp", "", stageMdp(d));
    setStage("final", "", stageFinal(d));
  }

  function enterStage(i, instant) {
    STAGES.forEach((s, j) => {
      const el = $("#stage-" + s.id);
      el.classList.toggle("done", j < i);
      el.classList.toggle("active", j === i);
      $(".stage-state", el).textContent = j < i ? "Done" : j === i ? "Running" : "Waiting";
    });
    const body = $(`#stage-${STAGES[i].id} .stage-body`);
    FX.reveal($$(":scope > .kv > *", body), { y: 6, gap: 0.03, duration: 0.3, instant });
  }

  /* ================================================================ side panels */
  function resetPanels() {
    const dec = $("#decision");
    dec.dataset.action = "none";
    $("#decision-value").textContent = "—";
    $("#decision-value").removeAttribute("style");
    $("#decision-sub").textContent = "Run a scenario to get a recommendation.";
    $$(".ev").forEach((e) => { e.classList.remove("best"); $("b", e).textContent = "—"; });
    $("#gauge-value").textContent = "—";
    $("#gauge-prior").textContent = "";
    $("#gauge-fill").style.width = "0";
    $("#gauge").classList.remove("over");
    $("#gauge-mark").hidden = true;
    $("#gauge-flag").hidden = true;
    $("#traffic-seq").innerHTML = '<span class="muted">—</span>';
    $$("#time-bars .bar-row").forEach((r) => {
      r.classList.remove("chosen");
      $(".bar-fill", r).style.width = "0";
      $("b", r).textContent = "—";
    });
    $("#time-note").textContent = "Computed by A* in stage 1.";
    $("#run-tag").textContent = "Not run yet";
    ["times", "prior", "post", "action"].forEach((k) => ($("#flow-" + k).textContent = "—"));
    $("#flow-tag").textContent = "Run a scenario to fill in live values";
    STAGES.forEach((s) => setStage(s.id, "", ""));
  }

  function applyTimes(d, instant) {
    const a = d.astar;
    const values = { fast: a.minutes, detour: a.detour_minutes, back: a.backtrack_minutes };
    const max = Math.max(...Object.values(values));
    const rows = $$("#time-bars .bar-row");
    FX.widths(rows.map((r) => $(".bar-fill", r)), rows.map((r) => (values[r.dataset.key] / max) * 100), { instant });
    rows.forEach((r, i) => FX.count($("b", r), values[r.dataset.key], { fmt: (v) => String(Math.round(v)), delay: i * 0.08, instant }));
    $("#flow-times").textContent = `${a.minutes} / ${a.detour_minutes} / ${a.backtrack_minutes} min`;
  }

  function applyTraffic(d, instant) {
    $("#traffic-seq").innerHTML = pills(d.viterbi.path);
    FX.reveal($$("#traffic-seq > *"), { y: 6, gap: 0.08, instant });
    $("#flow-prior").textContent = d.viterbi.prior;
  }

  function applyGauge(d, instant) {
    const p = d.bayes.posterior, th = d.mdp.threshold;
    FX.count($("#gauge-value"), p, { fmt: (v) => v.toFixed(3), duration: 1, instant });
    $("#gauge-prior").textContent = `prior ${d.bayes.prior} → after sensor`;
    const fill = $("#gauge-fill");
    fill.style.background = p < 0.34 ? "var(--green)" : p < 0.67 ? "var(--amber)" : "var(--red)";
    FX.width(fill, Math.max(p * 100, 1.5), { instant });
    const mark = $("#gauge-mark");
    if (th !== null) {
      mark.hidden = false;
      mark.style.left = th * 100 + "%";
      $("#gauge-mark-label").textContent = `reroute above ${f(th)}`;
    }
    const over = th !== null && p > th;
    $("#gauge").classList.toggle("over", over);
    $("#gauge-flag").hidden = !over;
    if (over) FX.pop($("#gauge-flag"), { delay: 0.8, instant });
    $("#flow-post").textContent = f(p, 3);
  }

  function applyDecision(d, instant) {
    const m = d.mdp;
    ["Continue", "Reroute"].forEach((a, i) =>
      FX.count($("b", $("#ev-" + a.toLowerCase())), m.expected[a], { fmt: (v) => f(v), duration: 0.9, delay: i * 0.1, instant }));
    $$(".ev").forEach((el) => el.classList.toggle("best", el.id === "ev-" + m.action.toLowerCase()));
    $("#decision").dataset.action = m.action;
    $("#decision-value").textContent = m.action.toUpperCase();
    $("#decision-sub").textContent = m.action === "Reroute"
      ? "Take the detour now. The fast road is too likely to be blocked."
      : "Stay on the fast road. The blockage risk is low.";
    FX.pop($("#decision-value"), { delay: 0.9, from: 0.6, instant });
    FX.pulse($(".ev.best"), { delay: 1.0 });
    $("#flow-action").textContent = m.action;
  }

  function applyFinal(d, instant) {
    STAGES.forEach((s) => {
      const el = $("#stage-" + s.id);
      el.classList.remove("active");
      el.classList.add("done");
      $(".stage-state", el).textContent = "Done";
    });
    const chosen = d.final.rerouted ? "detour" : "fast";
    $$("#time-bars .bar-row").forEach((r) => r.classList.toggle("chosen", r.dataset.key === chosen));
    if (!instant) FX.pulse($(`#time-bars .bar-row[data-key="${chosen}"]`));
    $("#time-note").textContent = `Planned travel time: ${d.final.minutes} minutes.`;
    $("#ambulance").classList.remove("driving");
    $("#ghost").classList.remove("driving");
    if (!ANIMATED) {       // without the timeline, put the vehicles at the hospital
      const path = d.final.path;
      setPose($("#ambulance"), path[path.length - 1], null);
      if (d.final.rerouted) setPose($("#ghost"), path[path.length - 1], null);
    }
  }

  function markBlocked(instant) {
    const risky = cellEl(state.config.risky_road);
    risky.classList.add("blocked");
    $(".glyph", risky).textContent = "✕";
    $("#route-fast").classList.add("abandoned");
    if (!instant) { FX.shake(risky); FX.pulse(risky, { scale: 1.08, delay: 0.5 }); }
  }

  /* ================================================================ the run player */
  /**
   * Builds the animation for one result `d`.
   * `at(time, fn)` registers the final state of each step; fn(instant) must be safe to
   * apply once, either animated (normal playback) or instantly (after a jump).
   */
  function createPlayer(d, hooks) {
    const map = $("#map");
    const size = GEO.fitOverlay(map, $("#map-svg"));
    sizeVehicles();
    const a = d.astar, rerouted = d.final.rerouted;
    const events = [], stageTimes = [];
    const flags = { astarCount: 0, bfsCount: 0, minuteAmb: 0, minuteGhost: 0 };
    const at = (time, fn) => events.push({ time, fn, done: false });
    let seeking = false, stopAt = null, completed = false, destroyed = false;

    const tl = ANIMATED ? A.createTimeline({
      autoplay: false,
      onUpdate: () => { if (!seeking) sync(false); },
      onComplete: () => finish(),
    }) : null;
    const add = (targets, params, time) => { if (tl) tl.add(targets, params, time); };
    const hide = (targets, params) => { if (tl) tl.set(targets, params, 0); };
    const drawable = (el) => (tl ? A.createDrawable(el) : el);
    const drive = (vehicle, path, duration, time) => {
      if (!tl) return;
      const mp = A.createMotionPath(path);
      add(vehicle, { translateX: mp.translateX, translateY: mp.translateY, rotate: mp.rotate, duration, ease: "linear" }, time);
    };

    // route geometry for this run
    const fast = $("#route-fast"), detour = $("#route-detour"), ghostLine = $("#route-ghost");
    fast.setAttribute("d", GEO.routePath(map, a.path));
    detour.setAttribute("d", rerouted ? GEO.routePath(map, d.final.path) : "");
    ghostLine.setAttribute("d", rerouted ? GEO.routePath(map, a.turn_back_path) : "");
    const amb = $("#ambulance"), ghost = $("#ghost");
    setPose(amb, a.path[0], a.path[1]);
    setPose(ghost, a.path[0], a.path[1]);

    /* ---- stage 1: A* search ------------------------------------------------ */
    let t = 0;
    stageTimes.push(t);
    at(t, (instant) => { enterStage(0, instant); mapStats(); });
    const IA = 230, t0 = 300;
    a.search.forEach((e, i) => {
      const el = $(".xp", cellEl(e.cell));
      el.innerHTML = `<em>f</em>${e.f}`;
      hide(el, { opacity: 0 });
      add(el, { opacity: [0, 1], scale: [0.4, 1], duration: 320, ease: "outBack" }, t0 + i * IA);
      at(t0 + i * IA, () => { flags.astarCount = i + 1; mapStats(); });
    });
    if (!tl) a.search.forEach((e) => { $(".xp", cellEl(e.cell)).style.opacity = 1; });
    const nB = state.compareBfs ? a.bfs_search.length : 0;
    for (let j = 0; j < nB; j++) {
      const el = $(".xb", cellEl(a.bfs_search[j]));
      el.textContent = j + 1;
      hide(el, { opacity: 0 });
      add(el, { opacity: [0, 1], scale: [0.4, 1], duration: 320, ease: "outBack" }, t0 + j * IA);
      at(t0 + j * IA, () => { flags.bfsCount = j + 1; mapStats(); });
      if (!tl) el.style.opacity = 1;
    }
    t = t0 + Math.max(a.search.length, nB) * IA + 150;
    const fastDraw = drawable(fast);
    hide(fastDraw, { draw: "0 0" });
    at(t, () => { fast.classList.add("show"); flags.fastRoute = true; mapStats(); });
    add(fastDraw, { draw: ["0 0", "0 1"], duration: 900, ease: "inOutQuad" }, t);
    t += 900;
    at(t, (instant) => { map.classList.add("search-done"); setSteps(a.path, instant); applyTimes(d, instant); });
    t += 900;

    /* ---- stage 2: Viterbi trellis --------------------------------------- */
    stageTimes.push(t);
    at(t, (instant) => { enterStage(1, instant); applyTraffic(d, instant); });
    const tr = $("#trellis");
    const nodes = (k) => $$(`.tr-node[data-col="${k}"]`, tr);
    const edges = (k) => $$(`.tr-edge[data-col="${k}"]`, tr);
    const cols = d.viterbi.observations.length;
    let tv = t + 250;
    for (let k = 0; k < cols; k++) {
      hide(nodes(k), { opacity: 0 });
      add(nodes(k), { opacity: [0, 1], scale: [0.3, 1], duration: 380, ease: "outBack", delay: A ? A.stagger(90) : 0 }, tv);
      tv += 430;
      if (k < cols - 1) {
        const ed = edges(k).map(drawable).flat();
        hide(ed, { draw: "0 0" });
        add(ed, { draw: ["0 0", "0 1"], duration: 360, ease: "outQuad" }, tv);
        tv += 380;
      }
    }
    at(tv, () => tr.classList.add("traced"));
    $$(".tr-best", tr).forEach((line) => {      // already in backwards order
      const dr = drawable(line);
      hide(dr, { draw: "0 0" });
      add(dr, { draw: ["0 0", "0 1"], duration: 380, ease: "inOutQuad" }, tv);
      tv += 380;
    });
    t = tv + 500;

    /* ---- stage 3: Bayes' rule -------------------------------------------- */
    stageTimes.push(t);
    at(t, (instant) => enterStage(2, instant));
    const b = d.bayes, s = b.steps;
    const segB = $("#bv-b"), segC = $("#bv-c");
    const pct = (x) => (x * 100).toFixed(2) + "%";
    const phases = [[b.prior, 1 - b.prior], [s.joint_blocked, s.joint_clear], [b.posterior, 1 - b.posterior]];
    hide([segB, segC], { width: "0%" });
    let tb = t + 250, prev = [0, 0];
    phases.forEach((ph, i) => {
      at(tb, (instant) => bayesPhase(i, d, instant));
      add(segB, { width: [pct(prev[0]), pct(ph[0])], duration: 650, ease: "inOutQuad" }, tb);
      add(segC, { width: [pct(prev[1]), pct(ph[1])], duration: 650, ease: "inOutQuad" }, tb);
      prev = ph;
      tb += i < 2 ? 1500 : 800;
    });
    at(tb, (instant) => applyGauge(d, instant));
    t = tb + 1300;

    /* ---- stage 4: MDP decision ------------------------------------------- */
    stageTimes.push(t);
    at(t, (instant) => { enterStage(3, instant); applyDecision(d, instant); });
    t += 2200;

    /* ---- stage 5: re-plan and drive -------------------------------------- */
    stageTimes.push(t);
    at(t, (instant) => enterStage(4, instant));
    const STEP = 170;
    let tf = t + 300;
    if (rerouted) {
      at(tf, (instant) => { markBlocked(instant); flags.rerouted = true; $$("#map .step").forEach((x) => (x.textContent = "")); });
      tf += 500;
      at(tf, () => { flags.replanning = true; mapStats(); });
      a.detour_search.forEach((e, i) => {
        const el = $(".xd", cellEl(e.cell));
        hide(el, { opacity: 0 });
        add(el, { opacity: [0, 1], duration: 220 }, tf + i * 40);
        if (!tl) el.style.opacity = 1;
      });
      tf += a.detour_search.length * 40 + 150;
      const detDraw = drawable(detour);
      hide(detDraw, { draw: "0 0" });
      at(tf, () => detour.classList.add("show"));
      add(detDraw, { draw: ["0 0", "0 1"], duration: 900, ease: "inOutQuad" }, tf);
      tf += 900;
      at(tf, (instant) => setSteps(d.final.path, instant));
      // the ambulance takes the detour; a ghost shows the turn-back alternative at the same speed
      const ghostDraw = drawable(ghostLine);
      hide(ghostDraw, { draw: "0 0" });
      const ghostMs = (a.turn_back_path.length - 1) * STEP;
      at(tf, () => { ghostLine.classList.add("show"); ghost.classList.add("show", "driving"); amb.classList.add("driving"); flags.drive = true; });
      add(ghostDraw, { draw: ["0 0", "0 1"], duration: ghostMs, ease: "linear" }, tf);
      drive(amb, detour, (d.final.path.length - 1) * STEP, tf);
      drive(ghost, ghostLine, ghostMs, tf);
      for (let m = 1; m <= a.turn_back_path.length - 1; m++) {
        at(tf + m * STEP, () => {
          flags.minuteAmb = Math.min(m, d.final.minutes);
          flags.minuteGhost = m;
          if (m === d.final.minutes) amb.classList.remove("driving");
          mapStats();
        });
      }
      tf += ghostMs + 300;
    } else {
      at(tf, () => { amb.classList.add("driving"); flags.drive = true; mapStats(); });
      const dur = (a.path.length - 1) * STEP * 1.6;
      drive(amb, fast, dur, tf);
      for (let m = 1; m <= d.final.minutes; m++) {
        at(tf + (m * dur) / d.final.minutes, () => { flags.minuteAmb = m; mapStats(); });
      }
      tf += dur + 300;
    }
    at(tf, (instant) => { flags.arrived = true; applyFinal(d, instant); mapStats(); });
    const duration = tf + 50;
    if (tl) tl.call(() => {}, duration);
    events.sort((x, y) => x.time - y.time);

    /* ---- playback ---------------------------------------------------------- */
    function now() { return tl ? tl.currentTime : completed ? duration : 0; }
    function currentStage() {
      const tt = now();
      let k = 0;
      stageTimes.forEach((st, i) => { if (tt >= st - 1) k = i; });
      return k;
    }
    function sync(instant) {
      if (destroyed) return;
      const tt = now();
      for (const e of events) {
        if (!e.done && e.time <= tt + 1) { e.done = true; e.fn(instant || seeking); }
      }
      if (!seeking && tl && stopAt !== null && tt >= stopAt - 1) {
        const s2 = stopAt;
        stopAt = null;
        tl.pause();
        seekTo(s2);
      }
      hooks.update(api);
    }
    function seekTo(time) {
      if (!tl) return;
      seeking = true;
      tl.seek(Math.max(0, Math.min(time, duration)));
      seeking = false;
      sync(true);
    }
    function finish() {
      if (completed || destroyed) return;
      completed = true;
      stopAt = null;
      seeking = true;
      sync(true);
      seeking = false;
      hooks.finish(api);
    }
    function nextBoundary(after) {
      const n = stageTimes.find((st) => st > after + 5);
      return n === undefined ? null : n;
    }

    const api = {
      flags, size, stageTimes, duration,
      get time() { return now(); },
      get completed() { return completed; },
      get playing() { return !!tl && !tl.paused && !completed; },
      currentStage,
      play() {
        if (!tl || completed) return;
        stopAt = state.stepMode ? nextBoundary(now()) : null;
        tl.play();
        hooks.update(api);
      },
      pause() { if (tl && !completed) { tl.pause(); stopAt = null; hooks.update(api); } },
      jumpToTime(time) {
        if (!tl) return;
        if (time >= duration) { seekTo(duration); finish(); return; }
        seekTo(time);
        if (api.playing && state.stepMode) stopAt = nextBoundary(now());
        hooks.update(api);
      },
      jumpToStage(i) { api.jumpToTime(stageTimes[i]); },
      next() {
        const n = nextBoundary(now());
        if (n === null) api.skip(); else api.jumpToTime(n);
      },
      skip() {
        if (!tl) { seeking = true; sync(true); seeking = false; finish(); return; }
        api.jumpToTime(duration);
      },
      setSpeed(v) { if (tl) tl.speed = v; },
      destroy() {
        destroyed = true;
        if (tl) { tl.pause(); try { tl.revert(); } catch { /* nothing to revert */ } }
      },
    };
    return api;
  }

  /* ================================================================ run and playback controls */
  function setRunButton(busy) {
    const btn = $("#run-btn");
    btn.disabled = busy;
    $("span", btn).textContent = busy ? "Loading…" : "Run simulation";
  }

  function stopPlayer() {
    if (state.player) state.player.destroy();
    state.player = null;
    FX.stopAll();
  }

  /** (Re)build the animation for the current result. Used by Run, Replay, jumps and resizes. */
  function startPlayback({ autoplay = true, atTime = null } = {}) {
    const d = state.result;
    if (!d) return;
    stopPlayer();
    resetMap();
    resetPanels();
    renderStageBodies(d);
    $("#run-tag").textContent = `Scenario: ${d.scenario.title}`;
    $("#flow-tag").textContent = `Live values from scenario: ${d.scenario.title}`;
    const player = createPlayer(d, { update: updatePlayerUI, finish: onFinished });
    state.player = player;
    player.setSpeed(state.speed);
    const bar = $("#player");
    if (bar.hidden) { bar.hidden = false; FX.reveal(bar, { y: 8 }); }
    if (!ANIMATED) { player.skip(); return; }
    if (atTime !== null && atTime > 0) player.jumpToTime(atTime);
    if (autoplay && !player.completed) player.play();
    updatePlayerUI(player);
  }

  async function run() {
    if (state.fetching || !state.config) return;
    clearError();
    state.fetching = true;
    setRunButton(true);
    setStatus("running", "Running simulation");
    const body = state.scenario === "custom"
      ? { custom: { speeds: state.speeds, alert: state.alert } }
      : { scenario: state.scenario };
    let d;
    try {
      d = await api("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      state.fetching = false;
      setRunButton(false);
      showError(err.message);
      return;
    }
    state.fetching = false;
    setRunButton(false);
    state.result = d;
    if (state.flow) { state.flow.revert(); state.flow = null; }
    startPlayback({ autoplay: true });
  }

  function reset() {
    stopPlayer();
    state.result = null;
    if (state.flow) { state.flow.revert(); state.flow = null; }
    clearError();
    resetMap();
    resetPanels();
    $("#player").hidden = true;
    if (state.config) setStatus("ready", "Backend connected");
  }

  function updatePlayerUI(p) {
    if (!p || p !== state.player) return;
    const stage = p.currentStage();
    const toggle = $("#pl-toggle");
    const mode = p.completed ? "replay" : p.playing ? "pause" : "play";
    toggle.dataset.mode = mode;
    $("span", toggle).textContent = { replay: "↺", pause: "❚❚", play: "▶" }[mode];
    toggle.setAttribute("aria-label", { replay: "Replay", pause: "Pause", play: "Play" }[mode]);
    $$("#pl-ticks .tick").forEach((t, i) => {
      t.classList.toggle("done", p.completed || i < stage);
      t.classList.toggle("current", !p.completed && i === stage);
    });
    $("#pl-fill").style.width = Math.min(100, (p.time / p.duration) * 100) + "%";
    $("#pl-next").disabled = p.completed;
    $("#pl-skip").disabled = p.completed;
    if (p.completed) return;
    setStatus(p.playing ? "running" : "paused",
      `${p.playing ? "Playing" : "Paused"} · stage ${stage + 1} of 5: ${STAGES[stage].title}`);
  }

  function onFinished(p) {
    if (p !== state.player) return;
    const d = state.result;
    updatePlayerUI(p);
    setStatus("done", `Complete · ${d.final.action} · ${d.final.minutes} min`);
    if (state.view === "flow") flowLoop(true);
  }

  function togglePlay() {
    const p = state.player;
    if (!p) { run(); return; }
    if (p.completed) startPlayback({ autoplay: true });
    else if (p.playing) p.pause();
    else p.play();
  }

  function jumpToStage(i) {
    const p = state.player;
    if (!p) return;
    const target = p.stageTimes[i];
    if (target >= p.time - 1 && !p.completed) {
      p.jumpToStage(i);
    } else {                                  // going back: rebuild, then jump forward
      const wasPlaying = p.playing;
      startPlayback({ autoplay: wasPlaying, atTime: target });
    }
  }

  function setSpeed(v) {
    state.speed = v;
    $$("#pl-speed button").forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.speed) === v)));
    if (state.player) state.player.setSpeed(v);
  }

  /** Rebuild at the same moment if the map changed size (window resize, view switch). */
  function ensureLayout() {
    const p = state.player;
    if (!p || state.view !== "dashboard") return;
    const map = $("#map");
    if (Math.abs(map.clientWidth - p.size[0]) < 2 && Math.abs(map.clientHeight - p.size[1]) < 2) return;
    if (p.completed) startPlayback({ autoplay: false, atTime: p.duration });
    else startPlayback({ autoplay: p.playing, atTime: p.time });
  }

  function wirePlayer() {
    $("#pl-toggle").addEventListener("click", togglePlay);
    $("#pl-next").addEventListener("click", () => state.player && state.player.next());
    $("#pl-skip").addEventListener("click", () => state.player && state.player.skip());
    $("#pl-replay").addEventListener("click", () => state.result && startPlayback({ autoplay: true }));
    $$("#pl-ticks .tick").forEach((t) => t.addEventListener("click", () => jumpToStage(Number(t.dataset.stage))));
    $$("#pl-speed button").forEach((b) => b.addEventListener("click", () => setSpeed(Number(b.dataset.speed))));
    $("#pl-step").addEventListener("change", (e) => {
      state.stepMode = e.target.checked;
      const p = state.player;
      if (p && p.playing) { p.pause(); p.play(); }   // re-arm the stop point
    });
    $("#bfs-toggle").addEventListener("click", (e) => {
      state.compareBfs = !state.compareBfs;
      e.currentTarget.setAttribute("aria-pressed", String(state.compareBfs));
      if (state.result) startPlayback({ autoplay: true });
    });
    // presenter shortcuts on the dashboard: Space = play/pause, → = next stage
    document.addEventListener("keydown", (e) => {
      if (state.view !== "dashboard" || !state.player) return;
      if (e.target.closest("input, textarea, select, button")) return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.code === "ArrowRight") { e.preventDefault(); state.player.next(); }
    });
  }

  /* ================================================================ data-flow page */
  /** Packets travel along the arrows, carrying the live values, while the page is open. */
  function flowLoop(on) {
    if (!on) { if (state.flow) state.flow.pause(); return; }
    if (!ANIMATED || !state.result || !(state.player && state.player.completed)) return;
    if (!state.flow) state.flow = buildFlowLoop();
    state.flow.play();
  }

  function buildFlowLoop() {
    const tl = A.createTimeline({ autoplay: false, loop: true, loopDelay: 900 });
    const move = (n, time) => {
      const track = $(`#fl-${n} .track`), packet = $(".packet", track);
      const horizontal = track.offsetWidth >= track.offsetHeight;
      tl.set(packet, { left: horizontal ? "0%" : "50%", top: horizontal ? "50%" : "0%", opacity: 0 }, 0);
      tl.add(packet, { [horizontal ? "left" : "top"]: ["0%", "100%"], duration: 760, ease: "inOutSine" }, time);
      tl.add(packet, { opacity: [0, 1], duration: 140 }, time);
      tl.add(packet, { opacity: [1, 0], duration: 160 }, time + 600);
      tl.add($(`#fl-${n} b`), { scale: [{ to: 1.18, duration: 200 }, { to: 1, duration: 240 }], ease: "outQuad" }, time);
    };
    const arrive = (id, time) =>
      tl.add("#fn-" + id, { scale: [{ to: 1.05, duration: 180 }, { to: 1, duration: 220 }], ease: "outQuad" }, time);
    move(1, 0); move(2, 0);
    arrive("bayes", 760);
    move(3, 820);
    arrive("mdp", 1580);
    move(4, 1640);
    arrive("replan", 2400);
    return tl;
  }

  /* ================================================================ assumptions page */
  function buildAssumptions() {
    const { hmm, sensor, mdp, scenarios, grid } = state.config;
    const matrix = (rowsLabel, rows, cols, get) => `<div class="table-wrap"><table class="table"><thead><tr><th>${rowsLabel}</th>${cols.map((c) =>
      `<th class="n">${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) =>
      `<tr><td>${r}</td>${cols.map((c) => `<td class="n">${get(r, c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const card = (title, note, body) => `<div class="card"><div class="card-head"><h2>${title}</h2><span class="tag">assumed</span></div><p>${note}</p>${body}</div>`;

    $("#assumptions").innerHTML = [
      card("City map", "A 6×6 grid. # is permanently closed, S is the start, H is the hospital. Each move costs one minute.",
        `<div class="formula" style="white-space:pre;line-height:1.5">${grid.map((r) => [...r].join(" ")).join("\n")}</div>`),
      card("Scenarios", "The inputs each preset feeds into the pipeline.",
        matrix("Scenario", scenarios.map((s) => s.title), ["Speed reports", "Sensor"], (r, c) => {
          const s = scenarios.find((x) => x.title === r);
          return c === "Sensor" ? (s.alert ? "alert" : "no alert") : s.speeds.join(", ");
        })),
      card("Traffic model: starting belief and persistence", "Chance of each traffic state at the first report, and of moving between states from one report to the next.",
        matrix("Start", ["P(state)"], hmm.states, (r, c) => hmm.start[c]) +
        matrix("From → to", hmm.states, hmm.states, (r, c) => hmm.transitions[r][c])),
      card("Traffic model: speed reports", "How likely each report is in each traffic state, and the prior chance of a full blockage that each state implies.",
        matrix("State", hmm.states, state.config.speed_values, (r, c) => hmm.emissions[r][c]) +
        matrix("State", hmm.states, ["Prior P(Blocked)"], (r) => hmm.prior_blocked[r])),
      card("Traffic sensor", "The sensor catches most blockages but also gives false alarms.",
        matrix("Road is", ["Blocked", "Clear"], ["P(alert)"], (r) => r === "Blocked" ? sensor.p_alert_if_blocked : sensor.p_alert_if_clear)),
      card("Decision model", `The road can change before the ambulance arrives. Rewards are not assumed: they are minus the A* travel times. Discount factor γ = ${mdp.gamma} (no effect in the one-step update).`,
        matrix("Road now → on arrival", mdp.states, mdp.states, (r, c) => mdp.road_dynamics[r][c])),
    ].join("");
  }

  /* ================================================================ results page */
  async function buildResults() {
    let ev;
    try {
      ev = await api("/api/evaluate");
    } catch (err) {
      $("#policy-bars").innerHTML = `<span class="muted">Could not load results: ${err.message}</span>`;
      $("#res-tag").textContent = "Error";
      return;
    }
    $("#res-tag").textContent = `${ev.trials.toLocaleString("en-US")} simulated trips · seed ${ev.seed}`;

    const max = Math.max(...ev.policies.map((p) => p.mean_minutes));
    $("#policy-bars").innerHTML = ev.policies.map((p) => {
      const cls = p.policy === "AETHER" ? "ours" : p.policy === "Perfect knowledge" ? "oracle" : "";
      return `<div class="policy-row ${cls}"><span>${p.policy}</span>
        <div class="bar-track"><div class="bar-fill"></div></div>
        <b>${f(p.mean_minutes)} min</b></div>`;
    }).join("");
    const pct = (x) => (x * 100).toFixed(1) + "%";
    $("#policy-table").innerHTML = `<thead><tr><th>Policy</th><th>Rule</th><th class="n">Mean minutes</th>
      <th class="n">Hit a blocked road</th><th class="n">Rerouted</th></tr></thead><tbody>${ev.policies.map((p) =>
      `<tr class="${p.policy === "AETHER" ? "ours" : ""}"><td>${p.policy}</td><td>${p.description}</td>
       <td class="n">${f(p.mean_minutes)}</td><td class="n">${pct(p.hit_block_rate)}</td><td class="n">${pct(p.reroute_rate)}</td></tr>`).join("")}</tbody>`;

    $("#search-table").innerHTML = `<thead><tr><th>Task</th><th class="n">A* min</th><th class="n">A* cells</th>
      <th class="n">BFS min</th><th class="n">BFS cells</th></tr></thead><tbody>${ev.search.map((r) =>
      `<tr><td>${r.task}</td><td class="n">${r.astar_minutes}</td><td class="n best">${r.astar_expanded}</td>
       <td class="n">${r.bfs_minutes}</td><td class="n">${r.bfs_expanded}</td></tr>`).join("")}</tbody>`;

    $("#inputs-table").innerHTML = `<thead><tr><th>Speed reports</th><th>Sensor</th><th>Viterbi: traffic now</th>
      <th class="n">Prior</th><th class="n">P(Blocked)</th><th class="n">EV Continue</th><th class="n">EV Reroute</th>
      <th>Decision</th></tr></thead><tbody>${ev.inputs.map((r) =>
      `<tr><td>${r.speeds.join(", ")}</td><td>${r.alert ? "alert" : "no alert"}</td><td>${r.traffic_now}</td>
       <td class="n">${r.prior}</td><td class="n">${f(r.posterior, 3)}</td><td class="n">${f(r.ev_continue)}</td>
       <td class="n">${f(r.ev_reroute)}</td><td class="act-${r.action}">${r.action}</td></tr>`).join("")}</tbody>`;

    // reveal-on-scroll: bars grow and rows slide in the first time each block is seen
    const bars = $$("#policy-bars .bar-fill");
    const widths = ev.policies.map((p) => (p.mean_minutes / max) * 100);
    const hiddenRows = (sel) => { const rows = $$(sel); if (FX.enabled) rows.forEach((r) => (r.style.opacity = 0)); return rows; };
    const policyRows = hiddenRows("#policy-table tbody tr");
    const searchRows = hiddenRows("#search-table tbody tr");
    const inputRows = hiddenRows("#inputs-table tbody tr");
    FX.onceInView($("#policy-bars"), (instant) => FX.widths(bars, widths, { gap: 0.1, instant }));
    FX.onceInView($("#policy-table"), (instant) => FX.reveal(policyRows, { gap: 0.06, instant }));
    FX.onceInView($("#search-table"), (instant) => FX.reveal(searchRows, { gap: 0.08, instant }));
    FX.onceInView($("#inputs-table"), (instant) => FX.reveal(inputRows, { gap: 0.025, y: 6, instant }));
  }

  /* ================================================================ start */
  async function init() {
    $$(".nav-item").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
    window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
    $("#run-btn").addEventListener("click", run);
    $("#reset-btn").addEventListener("click", reset);
    $("#error-close").addEventListener("click", clearError);
    wirePlayer();
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        FX.moveIndicator($("#nav-indicator"), $(".nav-item.active"), { instant: true });
        ensureLayout();
        if (state.flow) { state.flow.revert(); state.flow = null; flowLoop(state.view === "flow"); }
      }, 200);
    });
    buildStages();
    showView(location.hash.slice(1) || "dashboard", { instant: true });

    try {
      state.config = await api("/api/config");
    } catch (err) {
      showError(err.message);
      $("#run-btn").disabled = true;
      return;
    }
    buildControls();
    buildMap();
    buildAssumptions();
    FX.pressable(".btn, .icon-btn, .segmented button, .chip-toggle, .nav-item, .tick");
    setStatus("ready", "Backend connected");
    buildResults();
  }

  // Read-only view of the dashboard state for the automated browser test (ui-test/run.js).
  window.AETHER_STATE = state;
  init();
})();
