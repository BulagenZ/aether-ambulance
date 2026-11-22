// Automated browser test of the AETHER dashboard.
//
//   npm install          (once, installs playwright-core)
//   npm run test:ui      (needs Google Chrome or Microsoft Edge installed)
//
// It starts the Flask app on port 5055, drives the dashboard in a headless browser and checks
// that the animated playback always shows the same results as the Python backend.
// Optional: node ui-test/run.js --shots <folder>   saves screenshots of each step.
const { chromium } = require("playwright-core");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = 5055;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, "..");
const shotsArg = process.argv.indexOf("--shots");
const SHOTS = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0, passes = 0;
const check = (cond, msg) => {
  console.log((cond ? "  PASS " : "  FAIL ") + msg);
  if (cond) passes++; else failures++;
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };

function startServer() {
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const server = spawn(python, ["app.py"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  return server;
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + "/api/config"); if (r.ok) return; } catch { /* not up yet */ }
    await wait(250);
  }
  throw new Error("The Flask server did not start on port " + PORT);
}

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* try the next browser */ }
  }
  throw new Error("Neither Google Chrome nor Microsoft Edge was found.");
}

async function state(page) {
  return page.evaluate(() => {
    const p = window.AETHER_STATE.player;
    return {
      time: p ? Math.round(p.time) : null, stage: p ? p.currentStage() : null, playing: p ? p.playing : null,
      completed: p ? p.completed : null, decision: document.querySelector("#decision-value").textContent,
      gauge: document.querySelector("#gauge-value").textContent, status: document.querySelector("#status-text").textContent,
      stats: document.querySelector("#map-stats").textContent, blocked: !!document.querySelector(".cell.blocked"),
    };
  });
}

async function ambulanceToHospital(page) {
  return page.evaluate(() => {
    const amb = document.querySelector("#ambulance").getBoundingClientRect();
    const h = document.querySelector('.cell[data-key="5,0"]').getBoundingClientRect();
    return Math.hypot(amb.x + amb.width / 2 - (h.x + h.width / 2), amb.y + amb.height / 2 - (h.y + h.height / 2));
  });
}

async function runTests(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("page error: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(BASE + "/#dashboard");
  await page.waitForFunction(() => document.querySelector("#status-text").textContent === "Backend connected");

  console.log("1. Rush hour plays in order");
  await page.click("#run-btn");
  let ordered = true, maxStage = 0, s = null;
  for (let i = 0; i < 150; i++) {
    await wait(200);
    s = await state(page);
    if (s.time === null) continue;
    if (s.stage < 3 && s.decision !== "—") ordered = false;
    if (s.stage < 2 && s.gauge !== "—") ordered = false;
    maxStage = Math.max(maxStage, s.stage);
    if (i === 6) await shot(page, "1-search.png");
    if (s.completed) break;
  }
  check(ordered, "no stage shows its result before it is reached");
  check(maxStage === 4 && s.completed, "all five stages played and the run completed");
  check(s.decision === "REROUTE" && s.gauge === "0.857", `decision REROUTE with P(Blocked) = 0.857 (got ${s.decision}, ${s.gauge})`);
  check(s.status.startsWith("Complete · Reroute · 15 min"), "status shows the final result");
  check(s.blocked, "risky road marked as blocked");
  check(s.stats.includes("Arrived after 15"), "map reports the arrival time");
  check((await ambulanceToHospital(page)) < 12, "ambulance ends on the hospital");
  await shot(page, "2-final.png");

  console.log("2. Jumping between stages");
  await page.click('.tick[data-stage="1"]');
  await wait(300);
  s = await state(page);
  check(s.stage === 1 && s.decision === "—" && !s.blocked, "jumping back to stage 2 clears the later stages");
  check(!s.playing, "after jumping back from a finished run the player waits");
  await page.click("#pl-next"); await wait(150);
  s = await state(page);
  check(s.stage === 2, "Next stage moves to stage 3");
  await page.click("#pl-next"); await wait(150);
  s = await state(page);
  check(s.stage === 3 && s.decision === "REROUTE", "stage 4 shows the decision");

  console.log("3. Play, pause, speed and skip");
  await page.click("#pl-toggle"); await wait(400);
  s = await state(page);
  check(s.playing, "play resumes");
  await page.click("#pl-toggle");
  s = await state(page);
  const t1 = s.time;
  await wait(600);
  s = await state(page);
  check(!s.playing && s.time === t1, "pause stops the timeline");
  await page.click('#pl-speed button[data-speed="2"]');
  await page.click("#pl-toggle"); await wait(500);
  s = await state(page);
  check(s.playing && s.time - t1 > 700, `2× speed plays faster (${s.time - t1} ms in 500 ms)`);
  await page.click("#pl-skip"); await wait(200);
  s = await state(page);
  check(s.completed && s.decision === "REROUTE" && s.stats.includes("Arrived"), "Skip to end shows the final state");

  console.log("4. Pause after each stage");
  await page.check("#pl-step");
  await page.click("#pl-replay");
  await wait(4500);
  s = await state(page);
  check(!s.playing && s.stage === 1, `stops at the start of stage 2 (stage ${s.stage + 1})`);
  await page.uncheck("#pl-step");
  await page.click('#pl-speed button[data-speed="1"]');

  console.log("5. Scenarios and the BFS comparison");
  await page.click('#scenario-picker [data-key="calm"]');
  await page.click("#bfs-toggle");
  await page.click("#run-btn");
  await wait(4800);
  const bfs = await page.evaluate(() => [...document.querySelectorAll(".xb")].filter((x) => x.textContent).length);
  check(bfs === 13, `BFS comparison marks 13 cells (got ${bfs})`);
  await shot(page, "3-bfs.png");
  await page.click("#pl-skip"); await wait(200);
  s = await state(page);
  check(s.decision === "CONTINUE" && s.gauge === "0.012" && !s.blocked, `Quiet night → CONTINUE, 0.012 (got ${s.decision}, ${s.gauge})`);
  await page.click("#bfs-toggle");
  await page.click('#scenario-picker [data-key="mixed"]');
  await page.click("#run-btn"); await wait(300); await page.click("#pl-skip"); await wait(200);
  s = await state(page);
  check(s.decision === "CONTINUE" && s.gauge === "0.069", `Jam history, silent sensor → CONTINUE, 0.069 (got ${s.decision}, ${s.gauge})`);
  await page.click('#scenario-picker [data-key="calm"]');
  await page.click("#alert-toggle");
  await page.click("#run-btn"); await wait(300); await page.click("#pl-skip"); await wait(200);
  s = await state(page);
  check(s.decision === "CONTINUE" && s.gauge === "0.500", `Custom (one alert on flowing traffic) → CONTINUE, 0.500 (got ${s.decision}, ${s.gauge})`);

  console.log("6. Resizing during a run");
  await page.click('#scenario-picker [data-key="rush"]');
  await page.click("#run-btn"); await wait(2500);
  await page.setViewportSize({ width: 1000, height: 800 }); await wait(900);
  s = await state(page);
  check(s.playing && s.stage <= 1 && s.decision === "—", "the run keeps playing from the same moment");
  await page.click("#pl-skip"); await wait(300);
  check((await ambulanceToHospital(page)) < 12, "the ambulance still ends on the hospital");
  await page.setViewportSize({ width: 1440, height: 900 });

  console.log("7. Pages");
  for (const v of ["algorithms", "flow", "results", "assumptions", "about", "dashboard"]) {
    await page.click(`.nav-item[data-view="${v}"]`);
    await wait(700);
    const active = await page.evaluate(() => document.querySelector(".view.active").id);
    check(active === "view-" + v, `opens the ${v} page`);
    if (v === "flow") {
      let seen = 0;
      const positions = new Set();
      for (let k = 0; k < 20; k++) {
        await wait(150);
        const r = await page.evaluate(() => [...document.querySelectorAll(".packet")].map((p) => [getComputedStyle(p).opacity, p.style.left + p.style.top]));
        r.forEach(([o, pos]) => { if (o > 0.1) { seen++; positions.add(pos); } });
      }
      check(seen > 3 && positions.size > 3, "data-flow packets move along the arrows");
      await shot(page, "4-flow.png");
    }
    if (v === "results") {
      await page.locator("#inputs-table").scrollIntoViewIfNeeded();
      await wait(1500);
      const r = await page.evaluate(() => ({
        bar: parseFloat(document.querySelector("#policy-bars .bar-fill").style.width),
        rows: [...document.querySelectorAll("#inputs-table tbody tr")].filter((x) => getComputedStyle(x).opacity > 0.9).length,
      }));
      check(r.bar > 50 && r.rows === 16, "results bars grow and all 16 input rows appear");
    }
  }
  const offset = await page.evaluate(() => {
    const i = document.querySelector("#nav-indicator").getBoundingClientRect();
    const a = document.querySelector(".nav-item.active").getBoundingClientRect();
    return Math.abs(i.top - a.top) + Math.abs(i.height - a.height);
  });
  check(offset < 3, "sidebar highlight sits behind the active page");

  console.log("8. Phone layout");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#run-btn"); await wait(400); await page.click("#pl-skip"); await wait(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, "no sideways scrolling on a phone");
  await shot(page, "5-phone.png");

  console.log("9. Reduced motion");
  const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const p2 = await rm.newPage();
  p2.on("pageerror", (e) => errors.push("page error (reduced motion): " + e.message));
  await p2.goto(BASE + "/#dashboard");
  await p2.waitForFunction(() => document.querySelector("#status-text").textContent === "Backend connected");
  await p2.click("#run-btn"); await wait(500);
  const r2 = await p2.evaluate(() => ({ d: document.querySelector("#decision-value").textContent, s: document.querySelector("#status-text").textContent }));
  check(r2.d === "REROUTE" && r2.s.startsWith("Complete"), "with reduced motion the result appears immediately");
  await rm.close();

  console.log("10. Errors");
  check(errors.length === 0, "no JavaScript errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

(async () => {
  const server = startServer();
  let browser;
  try {
    await waitForServer();
    browser = await launch();
    await runTests(browser);
  } catch (e) {
    console.error("Test run stopped:", e.message);
    failures++;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} of ${passes + failures} checks FAILED` : `\nAll ${passes} browser checks passed`);
  process.exit(failures ? 1 : 0);
})();
