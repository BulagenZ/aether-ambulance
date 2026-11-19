"""Testing and results: how well does AETHER do its job?

Run:  python evaluate.py

1. Search comparison  - A* against BFS on the same map (same route length, fewer cells?)
2. Every input        - the decision for all 16 possible inputs (8 speed patterns x alert / no alert)
3. Policy comparison  - 10,000 simulated trips: AETHER against simple rules of thumb

Important: the simulated trips are drawn from the same invented model the agent uses
(main.py). The comparison shows the decision logic is sound and consistent; it is not
a measurement of real-world performance.
"""
import itertools
import random

from astar import astar, find
from bfs import bfs
from main import (
    GRID,
    HMM_EMIT,
    HMM_START,
    HMM_STATES,
    HMM_TRANS,
    MDP_TRANS,
    P_ALERT_IF_BLOCKED,
    P_ALERT_IF_CLEAR,
    PRIOR_BLOCKED,
    RISKY_ROAD,
)
from pipeline import simulate

TRIALS = 10_000
SEED = 7
POLICIES = (
    ("AETHER", "Viterbi + Bayes + MDP (this project)"),
    ("Always continue", "Always take the fast road"),
    ("Always reroute", "Always take the detour"),
    ("Trust the sensor", "Reroute only when the sensor raises an alert"),
    ("Perfect knowledge", "Knows the road state in advance (best possible, not achievable)"),
)


# --------------------------------------------------------------------- 1. search
def search_comparison():
    start, goal = find(GRID, "S"), find(GRID, "H")
    rows = []
    for task, blocked in (("Fastest route", ()), ("Detour (risky road closed)", (RISKY_ROAD,))):
        a_path, a_expanded = astar(GRID, start, goal, extra_blocked=blocked)
        b_path, b_expanded = bfs(GRID, start, goal, extra_blocked=blocked)
        rows.append({
            "task": task,
            "astar_minutes": len(a_path) - 1,
            "astar_expanded": a_expanded,
            "bfs_minutes": len(b_path) - 1,
            "bfs_expanded": b_expanded,
        })
    return rows


# --------------------------------------------------------------------- 2. every input
def all_inputs():
    """Run the full pipeline for every possible input."""
    rows = []
    for speeds in itertools.product(("fast", "slow"), repeat=3):
        for alert in (False, True):
            r = simulate({"key": "custom", "title": "Custom", "speeds": list(speeds), "alert": alert})
            rows.append({
                "speeds": list(speeds),
                "alert": alert,
                "traffic_now": r["viterbi"]["traffic_now"],
                "prior": r["viterbi"]["prior"],
                "posterior": r["bayes"]["posterior"],
                "ev_continue": r["mdp"]["expected"]["Continue"],
                "ev_reroute": r["mdp"]["expected"]["Reroute"],
                "action": r["final"]["action"],
                "minutes": r["final"]["minutes"],
            })
    return rows


# --------------------------------------------------------------------- 3. simulated trips
def _pick(rng, distribution):
    """Draw one key from {key: probability}."""
    x, total = rng.random(), 0.0
    for key, p in distribution.items():
        total += p
        if x < total:
            return key
    return key


def sample_trip(rng):
    """Draw one trip from the assumed world model.

    Returns (speed reports, sensor alert, road state when the ambulance arrives).
    """
    traffic = [_pick(rng, HMM_START)]
    for _ in range(2):
        traffic.append(_pick(rng, HMM_TRANS[traffic[-1]]))
    speeds = tuple(_pick(rng, HMM_EMIT[s]) for s in traffic)

    blocked_now = rng.random() < PRIOR_BLOCKED[traffic[-1]]
    alert = rng.random() < (P_ALERT_IF_BLOCKED if blocked_now else P_ALERT_IF_CLEAR)
    road_now = "Blocked" if blocked_now else "Clear"
    road_on_arrival = _pick(rng, MDP_TRANS["Continue"][road_now])
    return speeds, alert, road_on_arrival


def policy_comparison(trials=TRIALS, seed=SEED):
    base = simulate({"key": "custom", "title": "Custom", "speeds": ["fast"] * 3, "alert": False})["astar"]
    fast, detour, backtrack = base["minutes"], base["detour_minutes"], base["backtrack_minutes"]

    # AETHER's decision for each of the 16 possible inputs, computed once by the real pipeline.
    aether = {(tuple(r["speeds"]), r["alert"]): r["action"] for r in all_inputs()}

    def choose(policy, speeds, alert, arrival):
        if policy == "AETHER":
            return aether[(speeds, alert)]
        if policy == "Always continue":
            return "Continue"
        if policy == "Always reroute":
            return "Reroute"
        if policy == "Trust the sensor":
            return "Reroute" if alert else "Continue"
        return "Continue" if arrival == "Clear" else "Reroute"   # perfect knowledge

    rng = random.Random(seed)
    totals = {name: {"minutes": 0, "hit_block": 0, "reroutes": 0} for name, _ in POLICIES}
    for _ in range(trials):
        speeds, alert, arrival = sample_trip(rng)
        for name, _ in POLICIES:
            action = choose(name, speeds, alert, arrival)
            if action == "Reroute":
                minutes = detour
                totals[name]["reroutes"] += 1
            elif arrival == "Clear":
                minutes = fast
            else:
                minutes = backtrack
                totals[name]["hit_block"] += 1
            totals[name]["minutes"] += minutes

    return [
        {
            "policy": name,
            "description": description,
            "mean_minutes": totals[name]["minutes"] / trials,
            "hit_block_rate": totals[name]["hit_block"] / trials,
            "reroute_rate": totals[name]["reroutes"] / trials,
        }
        for name, description in POLICIES
    ]


def evaluate(trials=TRIALS, seed=SEED):
    return {
        "search": search_comparison(),
        "inputs": all_inputs(),
        "policies": policy_comparison(trials, seed),
        "trials": trials,
        "seed": seed,
    }


# --------------------------------------------------------------------- console report
if __name__ == "__main__":
    result = evaluate()

    print("\n1. A* vs BFS on the same 6x6 map")
    print(f"   {'Task':28} {'A* min':>7} {'A* cells':>9} {'BFS min':>8} {'BFS cells':>10}")
    for r in result["search"]:
        print(f"   {r['task']:28} {r['astar_minutes']:>7} {r['astar_expanded']:>9} "
              f"{r['bfs_minutes']:>8} {r['bfs_expanded']:>10}")

    print("\n2. Decision for every possible input")
    print(f"   {'Speed reports':18} {'Sensor':9} {'Traffic':8} {'Prior':>5} {'P(Block)':>9} "
          f"{'EV cont.':>9} {'EV rer.':>8}  Decision")
    for r in result["inputs"]:
        print(f"   {', '.join(r['speeds']):18} {'alert' if r['alert'] else 'silent':9} {r['traffic_now']:8} "
              f"{r['prior']:>5} {r['posterior']:>9.3f} {r['ev_continue']:>9.2f} {r['ev_reroute']:>8.2f}  {r['action']}")

    print(f"\n3. {result['trials']:,} simulated trips (seed {result['seed']}), drawn from the assumed model")
    print(f"   {'Policy':18} {'Mean minutes':>13} {'Hit a blocked road':>19} {'Rerouted':>9}")
    for r in result["policies"]:
        print(f"   {r['policy']:18} {r['mean_minutes']:>13.2f} {r['hit_block_rate']:>18.1%} {r['reroute_rate']:>9.1%}")
    print("\n   Note: the trips come from the same invented model the agent uses,")
    print("   so this checks the decision logic, not real-world performance.")
