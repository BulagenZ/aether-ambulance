/* AETHER dashboard.
   This file only draws. Every number shown is returned by the Python backend
   (/api/config and /api/simulate). No result is computed or stored here. */
(() => {
  "use strict";

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? 0 : ms));
  const f = (x, d = 2) => Number(x).toFixed(d);
  const key = (cell) => cell[0] + "," + cell[1];

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
    scenario: "rush",          // preset key or "custom"
    speeds: [],
    alert: false,
    result: null,
    runId: 0,                  // increases on every run/reset so old animations stop
    running: false,
  };

  /* ------------------------------------------------------------ backend */
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
    $("#error-banner").hidden = false;
    setStatus("error", "Error");
  }
  function clearError() { $("#error-banner").hidden = true; }

  /* ------------------------------------------------------------ navigation */
  function showView(name) {
    if (!VIEWS[name]) name = "dashboard";
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    $("#view-title").textContent = VIEWS[name][0];
    $("#view-sub").textContent = VIEWS[name][1];
    if (location.hash.slice(1) !== name) history.replaceState(null, "", "#" + name);
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------ controls */
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

  /* ------------------------------------------------------------ map */
  const AMBULANCE_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="7" width="14" height="10" rx="2" fill="#fff"/>' +
    '<path d="M15.5 10h3.4l3.6 3.6V17h-7z" fill="#ff4f64"/><path d="M8.5 9v6M5.5 12h6" stroke="#ff4f64" stroke-width="2"/>' +
    '<circle cx="6.5" cy="18" r="2.2" fill="#0a0e15" stroke="#fff" stroke-width="1.2"/>' +
    '<circle cx="17.5" cy="18" r="2.2" fill="#0a0e15" stroke="#fff" stroke-width="1.2"/></svg>';

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
      cell.innerHTML = '<span class="glyph"></span><span class="step"></span>';
      cell.addEventListener("click", () => inspectCell(cell, r, c));
      map.appendChild(cell);
    }));
    const amb = document.createElement("div");
    amb.className = "ambulance";
    amb.id = "ambulance";
    amb.innerHTML = AMBULANCE_SVG;
    map.appendChild(amb);
    resetMap();
  }

  function cellEl(cell) { return $(`.cell[data-key="${key(cell)}"]`); }

  function resetMap() {
    $$(".cell").forEach((el) => {
      const kind = el.dataset.kind;
      el.className = "cell" + (kind !== "road" ? " " + kind : "");
      $(".glyph", el).textContent = kind === "goal" ? "H" : kind === "risky" ? "?" : "";
      $(".step", el).textContent = "";
      delete el.dataset.step;
      delete el.dataset.route;
    });
    moveAmbulance(state.config.start, false);
    $("#cell-info").textContent = "Click any cell to inspect it.";
  }

  function moveAmbulance(cell, animate = true) {
    const amb = $("#ambulance");
    amb.style.transition = animate && !reducedMotion ? "" : "none";
    amb.style.transform = `translate(calc(${cell[1]} * (100% + 6px)), calc(${cell[0]} * (100% + 6px)))`;
  }

  async function paintRoute(path, runId, label) {
    for (let i = 0; i < path.length; i++) {
      if (runId !== state.runId) return false;
      const el = cellEl(path[i]);
      el.classList.remove("old");
      el.classList.add("route");
      el.dataset.step = i;
      el.dataset.route = label;
      $(".step", el).textContent = i === 0 || i === path.length - 1 ? "" : i;
      await sleep(70);
    }
    return true;
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
    if (el.dataset.step !== undefined && el.classList.contains("route")) {
      text += ` Minute ${el.dataset.step} on the ${el.dataset.route}.`;
    } else if (el.classList.contains("old")) {
      text += " Part of the abandoned fast route.";
    }
    $("#cell-info").innerHTML = text;
  }

  /* ------------------------------------------------------------ stage cards */
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
        `cells expanded: <span class="hl">${a.expanded}</span> (BFS on the same map needs ${a.bfs_expanded})`,
        `second search with the risky road closed: detour = <span class="hl">${a.detour_minutes}</span> min`,
        `third search from (${a.turn_cell}) after ${a.minutes_to_turn} min: drive in and turn back = <span class="hl">${a.backtrack_minutes}</span> min`,
      ])],
      ["Output", `Fastest route: ${a.minutes} minutes. It ${a.uses_risky ? "passes through" : "avoids"} the risky road (${c.risky_road}).`, "out"],
      ["Why", "A* is optimal here and looks at fewer cells than BFS because the heuristic points it at the hospital.", "why"],
    ]);
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
      ["Steps", `<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Report</th>${states.map((s) =>
        `<th class="n">${s}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
        <div class="fine">Each number is the probability of the best state sequence ending in that state.</div>`],
      ["Output", `Most likely sequence: ${pills(v.path)} <span class="muted mono">(probability ${f(v.probability, 5)})</span><br>
        Traffic now = ${v.traffic_now} → prior P(Blocked) = ${v.prior}`, "out"],
      ["Why", "The traffic state is hidden and changes over time. Viterbi finds the best explanation of the reports.", "why"],
    ]);
  }

  function stageBayes(d) {
    const b = d.bayes, s = b.steps, obs = b.alert ? "alert" : "no alert", sen = state.config.sensor;
    return kv([
      ["Input", `Prior P(Blocked) = ${b.prior} (from stage 2). Sensor says: <b>${obs}</b>.
        P(alert | Blocked) = ${sen.p_alert_if_blocked}, P(alert | Clear) = ${sen.p_alert_if_clear}`],
      ["Steps", calc([
        `P(${obs} | Blocked) × P(Blocked) = ${f(s.like_blocked)} × ${f(b.prior)} = <span class="hl">${f(s.joint_blocked, 4)}</span>`,
        `P(${obs} | Clear) &nbsp;&nbsp;× P(Clear) &nbsp;&nbsp;= ${f(s.like_clear)} × ${f(1 - b.prior)} = <span class="hl">${f(s.joint_clear, 4)}</span>`,
        `P(${obs}) = ${f(s.joint_blocked, 4)} + ${f(s.joint_clear, 4)} = ${f(s.evidence, 4)}`,
      ])],
      ["Output", `P(Blocked | ${obs}) = ${f(s.joint_blocked, 4)} / ${f(s.evidence, 4)} = ${f(b.posterior, 3)}`, "out"],
      ["Why", "The sensor is noisy, so one reading should shift the belief, not replace it.", "why"],
    ]);
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
    const fin = d.final;
    return kv([
      ["Input", `Decision from stage 4: <b>${fin.action}</b>`],
      ["Steps", fin.rerouted
        ? "A* searches again with the risky road closed and returns the detour."
        : "No new search is needed. The original A* route is kept."],
      ["Output", `${fin.action.toUpperCase()} — planned travel time ${fin.minutes} minutes.`, "out"],
      ["Why", fin.rerouted
        ? "Re-planning turns the decision into a concrete route the driver can follow."
        : "The blockage risk is too low to justify ten extra minutes.", "why"],
    ]);
  }

  /* ------------------------------------------------------------ side panels */
  function resetPanels() {
    const d = $("#decision");
    d.dataset.action = "none";
    $("#decision-value").textContent = "—";
    $("#decision-sub").textContent = "Run a scenario to get a recommendation.";
    $$(".ev").forEach((e) => { e.classList.remove("best"); $("b", e).textContent = "—"; });
    $("#gauge-value").textContent = "—";
    $("#gauge-prior").textContent = "";
    $("#gauge-fill").style.width = "0";
    $("#gauge-mark").hidden = true;
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

  function showTimes(a) {
    const values = { fast: a.minutes, detour: a.detour_minutes, back: a.backtrack_minutes };
    const max = Math.max(...Object.values(values));
    $$("#time-bars .bar-row").forEach((r) => {
      const v = values[r.dataset.key];
      $(".bar-fill", r).style.width = (v / max) * 100 + "%";
      $("b", r).textContent = v;
    });
    $("#flow-times").textContent = `${a.minutes} / ${a.detour_minutes} / ${a.backtrack_minutes} min`;
  }

  function showGauge(d) {
    const p = d.bayes.posterior;
    $("#gauge-value").textContent = f(p, 3);
    $("#gauge-prior").textContent = `prior ${d.bayes.prior} → after sensor`;
    const fill = $("#gauge-fill");
    fill.style.width = Math.max(p * 100, 1.5) + "%";
    fill.style.background = p < 0.34 ? "var(--green)" : p < 0.67 ? "var(--amber)" : "var(--red)";
  }

  function showDecision(d) {
    const m = d.mdp;
    $("#decision").dataset.action = m.action;
    $("#decision-value").textContent = m.action.toUpperCase();
    $("#decision-sub").textContent = m.action === "Reroute"
      ? "Take the detour now. The fast road is too likely to be blocked."
      : "Stay on the fast road. The blockage risk is low.";
    for (const a of ["Continue", "Reroute"]) {
      const el = $("#ev-" + a.toLowerCase());
      $("b", el).textContent = f(m.expected[a]);
      el.classList.toggle("best", a === m.action);
    }
    if (m.threshold !== null) {
      const mark = $("#gauge-mark");
      mark.hidden = false;
      mark.style.left = m.threshold * 100 + "%";
      $("#gauge-mark-label").textContent = `reroute above ${f(m.threshold)}`;
    }
    $("#flow-action").textContent = m.action;
  }

  /* ------------------------------------------------------------ run */
  function setRunning(on) {
    state.running = on;
    const btn = $("#run-btn");
    btn.disabled = on;
    btn.lastChild.textContent = on ? " Running…" : " Run simulation";
  }

  function reset() {
    state.runId++;
    state.result = null;
    setRunning(false);
    clearError();
    resetMap();
    resetPanels();
    if (state.config) setStatus("ready", "Backend connected");
  }

  async function run() {
    if (state.running || !state.config) return;
    reset();
    const runId = state.runId;
    setRunning(true);
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
      if (runId === state.runId) { setRunning(false); showError(err.message); }
      return;
    }
    if (runId !== state.runId) return;
    state.result = d;
    const alive = () => runId === state.runId;
    $("#run-tag").textContent = `Scenario: ${d.scenario.title}`;
    $("#flow-tag").textContent = `Live values from scenario: ${d.scenario.title}`;

    // 1. A*
    setStage("astar", "active", stageAstar(d));
    if (!(await paintRoute(d.astar.path, runId, "fast route"))) return;
    showTimes(d.astar);
    await sleep(350); if (!alive()) return;
    setStage("astar", "done");

    // 2. Viterbi
    setStage("viterbi", "active", stageViterbi(d));
    $("#traffic-seq").innerHTML = pills(d.viterbi.path);
    $("#flow-prior").textContent = d.viterbi.prior;
    await sleep(650); if (!alive()) return;
    setStage("viterbi", "done");

    // 3. Bayes
    setStage("bayes", "active", stageBayes(d));
    showGauge(d);
    $("#flow-post").textContent = f(d.bayes.posterior, 3);
    await sleep(800); if (!alive()) return;
    setStage("bayes", "done");

    // 4. MDP
    setStage("mdp", "active", stageMdp(d));
    showDecision(d);
    await sleep(800); if (!alive()) return;
    setStage("mdp", "done");

    // 5. Final route
    setStage("final", "active", stageFinal(d));
    if (d.final.rerouted) {
      d.astar.path.forEach((c) => {
        const el = cellEl(c);
        el.classList.remove("route");
        el.classList.add("old");
        $(".step", el).textContent = "";
      });
      const risky = cellEl(state.config.risky_road);
      risky.classList.remove("old");
      risky.classList.add("blocked");
      $(".glyph", risky).textContent = "✕";
      await sleep(300);
      if (!(await paintRoute(d.final.path, runId, "detour"))) return;
    }
    $$("#time-bars .bar-row").forEach((r) =>
      r.classList.toggle("chosen", r.dataset.key === (d.final.rerouted ? "detour" : "fast")));
    $("#time-note").textContent = `Planned travel time: ${d.final.minutes} minutes.`;

    for (const c of d.final.path) {
      if (!alive()) return;
      moveAmbulance(c);
      await sleep(230);
    }
    setStage("final", "done");
    setRunning(false);
    setStatus("done", `Complete · ${d.final.action} · ${d.final.minutes} min`);
  }

  /* ------------------------------------------------------------ assumptions page */
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

  /* ------------------------------------------------------------ results page */
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
        <div class="bar-track"><div class="bar-fill" style="width:${(p.mean_minutes / max) * 100}%"></div></div>
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
  }

  /* ------------------------------------------------------------ start */
  async function init() {
    $$(".nav-item").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
    window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
    $("#run-btn").addEventListener("click", run);
    $("#reset-btn").addEventListener("click", reset);
    $("#error-close").addEventListener("click", clearError);
    showView(location.hash.slice(1) || "dashboard");
    buildStages();

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
    setStatus("ready", "Backend connected");
    buildResults();
  }

  init();
})();
