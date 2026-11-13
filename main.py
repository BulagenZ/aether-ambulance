"""Mini Ambulance Route Assistant - AI Fundamentals final project.

Run:  python main.py            (rush-hour scenario)
      python main.py calm       (quiet-night scenario)
      python main.py mixed      (jam history but silent sensor)

Pipeline (each step uses the previous step's output):
  1. A*       plans the fastest route to the hospital.
  2. Viterbi  reads three speed reports from the risky road -> current traffic state -> prior.
  3. Bayes    updates that prior with one sensor reading -> P(road blocked).
  4. MDP      uses P(road blocked) and the A* travel times -> Continue or Reroute.
  5. A*       re-plans around the road if the MDP says Reroute.

ALL NUMBERS BELOW ARE ASSUMPTIONS made up for this toy model, not real traffic data.
"""
import sys

from astar import astar, draw, find
from bayes import posterior_blocked
from mdp import ACTIONS, STATES, bellman_q, build_rewards, decide
from viterbi import viterbi

# ---------------------------------------------------------------- toy city map
GRID = [
    "S.....",
    ".#....",
    ".#....",
    ".####.",
    "......",
    "H.....",
]
RISKY_ROAD = (3, 0)  # the narrow road under the bridge that may be blocked

# ---------------------------------------------------------------- HMM (assumed)
HMM_STATES = ("Flowing", "Jammed")
HMM_START = {"Flowing": 0.6, "Jammed": 0.4}
HMM_TRANS = {
    "Flowing": {"Flowing": 0.7, "Jammed": 0.3},
    "Jammed": {"Flowing": 0.2, "Jammed": 0.8},
}
HMM_EMIT = {
    "Flowing": {"fast": 0.8, "slow": 0.2},
    "Jammed": {"fast": 0.2, "slow": 0.8},
}
# Prior chance the road is fully blocked, depending on the traffic state Viterbi finds.
PRIOR_BLOCKED = {"Flowing": 0.1, "Jammed": 0.4}

# ---------------------------------------------------------------- sensor (assumed)
P_ALERT_IF_BLOCKED = 0.9  # sensor catches a real blockage 90% of the time
P_ALERT_IF_CLEAR = 0.1    # false alarm 10% of the time

# ---------------------------------------------------------------- MDP (assumed)
# T[action][state][next_state]: the road may change before the ambulance gets there.
# The ambulance's choice does not affect the road, so both actions share one table.
_ROAD_DYNAMICS = {
    "Clear": {"Clear": 0.9, "Blocked": 0.1},
    "Blocked": {"Clear": 0.1, "Blocked": 0.9},
}
MDP_TRANS = {"Continue": _ROAD_DYNAMICS, "Reroute": _ROAD_DYNAMICS}
GAMMA = 0.9

# ---------------------------------------------------------------- scenarios
SCENARIOS = {
    "rush": {"title": "Rush hour", "speeds": ["fast", "slow", "slow"], "alert": True},
    "calm": {"title": "Quiet night", "speeds": ["fast", "fast", "fast"], "alert": False},
    "mixed": {"title": "Jam history, silent sensor", "speeds": ["slow", "slow", "slow"], "alert": False},
}


def header(text):
    print()
    print("=" * 64)
    print(text)
    print("=" * 64)


def run(scenario, verbose=True):
    """Run the whole pipeline. Returns a dict of results (used by the tests)."""
    say = print if verbose else (lambda *a, **k: None)
    start, goal = find(GRID, "S"), find(GRID, "H")

    if verbose:
        header(f"MINI AMBULANCE ROUTE ASSISTANT - scenario: {scenario['title']}")

    # ---- 1. A* -------------------------------------------------------------
    if verbose:
        header("STEP 1  A* search: fastest route to the hospital")
    fast_path, expanded = astar(GRID, start, goal)
    fast_min = len(fast_path) - 1
    say(f"Input : 6x6 grid, start S={start}, hospital H={goal}, 1 move = 1 minute")
    say("Steps : expand the cell with the lowest f = g (minutes so far) + h (Manhattan distance)")
    say(f"        cells expanded: {expanded}")
    say(f"Output: route of {fast_min} minutes   ('?' = risky road under the bridge)")
    say(draw(GRID, fast_path, {RISKY_ROAD: "?"}))
    uses_risky = RISKY_ROAD in fast_path
    say(f"Why   : A* is optimal here and looks at fewer cells than BFS because h points it at H.")
    say(f"        The route passes the risky road {RISKY_ROAD}: {uses_risky}")

    # Two more A* runs give the travel times the MDP needs.
    detour_path, _ = astar(GRID, start, goal, extra_blocked=[RISKY_ROAD])
    detour_min = len(detour_path) - 1
    before = fast_path[fast_path.index(RISKY_ROAD) - 1]       # last cell before the risky road
    to_block = fast_path.index(before)                          # minutes to get there
    back_path, _ = astar(GRID, before, goal, extra_blocked=[RISKY_ROAD])
    backtrack_min = to_block + len(back_path) - 1
    say(f"Also  : detour avoiding the road = {detour_min} min; "
        f"driving in, finding it blocked and turning back = {backtrack_min} min")

    # ---- 2. Viterbi --------------------------------------------------------
    if verbose:
        header("STEP 2  HMM / Viterbi: what is the traffic doing on that road?")
    speeds = scenario["speeds"]
    path, prob, table = viterbi(speeds, HMM_STATES, HMM_START, HMM_TRANS, HMM_EMIT)
    say(f"Input : last three speed reports = {speeds}")
    say("Steps : best probability of ending in each hidden state")
    for t, row in enumerate(table):
        cells = "   ".join(f"{s}={row[s]:.5f}" for s in HMM_STATES)
        say(f"        t={t + 1} ({speeds[t]:4}):  {cells}")
    say(f"Output: most likely sequence = {' -> '.join(path)}   (probability {prob:.5f})")
    traffic_now = path[-1]
    prior = PRIOR_BLOCKED[traffic_now]
    say(f"Why   : traffic state is hidden and changes over time; Viterbi finds the best explanation.")
    say(f"        Traffic now = {traffic_now}  ->  prior P(Blocked) = {prior}")

    # ---- 3. Bayes ----------------------------------------------------------
    if verbose:
        header("STEP 3  Bayes' rule: is the road actually blocked?")
    alert = scenario["alert"]
    p_blocked, s = posterior_blocked(prior, P_ALERT_IF_BLOCKED, P_ALERT_IF_CLEAR, alert)
    obs = "ALERT" if alert else "no alert"
    say(f"Input : prior P(Blocked) = {prior} (from step 2), sensor says: {obs}")
    say(f"        P(alert | Blocked) = {P_ALERT_IF_BLOCKED}, P(alert | Clear) = {P_ALERT_IF_CLEAR}")
    say(f"Steps : P({obs} | Blocked) * P(Blocked) = {s['like_blocked']:.2f} * {prior:.2f} = {s['joint_blocked']:.4f}")
    say(f"        P({obs} | Clear)   * P(Clear)   = {s['like_clear']:.2f} * {1 - prior:.2f} = {s['joint_clear']:.4f}")
    say(f"        P({obs}) = {s['evidence']:.4f}")
    say(f"Output: P(Blocked | {obs}) = {s['joint_blocked']:.4f} / {s['evidence']:.4f} = {p_blocked:.3f}")
    say("Why   : the sensor is noisy, so one reading should shift our belief, not replace it.")

    # ---- 4. MDP ------------------------------------------------------------
    if verbose:
        header("STEP 4  MDP: Continue on the fast road, or Reroute now?")
    rewards = build_rewards(fast_min, detour_min, backtrack_min)
    q = bellman_q(MDP_TRANS, rewards, GAMMA)
    action, expected = decide(p_blocked, q)
    say("Input : states {Clear, Blocked}, actions {Continue, Reroute}")
    say("        rewards = -minutes (from the A* routes in step 1):")
    for a in ACTIONS:
        say(f"          {a:8}: road Clear -> {rewards[a]['Clear']:4}, road Blocked -> {rewards[a]['Blocked']:4}")
    say("        road may change before arrival: stays the same 0.9, flips 0.1")
    say("Steps : one Bellman update, Q(s,a) = sum T(s'|s,a) * [R(a,s') + gamma*V(s')], V = 0")
    for st in STATES:
        say("          " + "   ".join(f"Q({st},{a}) = {q[st][a]:7.2f}" for a in ACTIONS))
    say(f"        weight by belief from step 3: P(Blocked) = {p_blocked:.3f}")
    for a in ACTIONS:
        say(f"          expected value of {a:8} = {expected[a]:7.2f}")
    say(f"Output: best action = {action.upper()}")
    say("Why   : the outcome of driving on is uncertain, so we compare expected rewards, not best cases.")

    # ---- 5. final route ----------------------------------------------------
    if verbose:
        header("STEP 5  Final plan")
    if action == "Reroute":
        final_path, final_min = detour_path, detour_min
        say("A* re-plans with the risky road closed ('X'):")
        say(draw(GRID, final_path, {RISKY_ROAD: "X"}))
    else:
        final_path, final_min = fast_path, fast_min
        say("Keep the original A* route:")
        say(draw(GRID, final_path))
    say(f"Decision: {action.upper()} - planned travel time {final_min} minutes.")

    return {
        "fast_min": fast_min,
        "detour_min": detour_min,
        "backtrack_min": backtrack_min,
        "traffic": path,
        "prior": prior,
        "p_blocked": p_blocked,
        "expected": expected,
        "action": action,
        "final_path": final_path,
    }


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "rush"
    if name not in SCENARIOS:
        print(f"Unknown scenario {name!r}. Choose one of: {', '.join(SCENARIOS)}")
        sys.exit(1)
    run(SCENARIOS[name])
