"""Runs the same five-stage pipeline as main.py, but returns every intermediate
result as plain data (for the website) instead of printing it.

Nothing is re-implemented here: the algorithms come from astar.py, viterbi.py,
bayes.py and mdp.py, and every assumed number comes from main.py.
"""
from astar import astar, find
from bfs import bfs
from bayes import posterior_blocked
from main import (
    GAMMA,
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
    SCENARIOS,
)
from mdp import ACTIONS, STATES, bellman_q, build_rewards, decide
from viterbi import viterbi

SPEED_VALUES = ("fast", "slow")
N_REPORTS = 3


class ScenarioError(ValueError):
    """The request did not describe a valid scenario."""


def resolve_scenario(payload):
    """Turn the JSON body of a request into a scenario dict, or raise ScenarioError."""
    if not isinstance(payload, dict):
        raise ScenarioError("Request body must be a JSON object.")

    if "custom" in payload:
        custom = payload["custom"]
        if not isinstance(custom, dict):
            raise ScenarioError("'custom' must be an object with 'speeds' and 'alert'.")
        speeds, alert = custom.get("speeds"), custom.get("alert")
        if not isinstance(speeds, list) or len(speeds) != N_REPORTS:
            raise ScenarioError(f"'speeds' must be a list of exactly {N_REPORTS} reports.")
        if any(s not in SPEED_VALUES for s in speeds):
            raise ScenarioError("Each speed report must be 'fast' or 'slow'.")
        if not isinstance(alert, bool):
            raise ScenarioError("'alert' must be true or false.")
        return {"key": "custom", "title": "Custom", "speeds": list(speeds), "alert": alert}

    key = payload.get("scenario")
    if key not in SCENARIOS:
        raise ScenarioError(f"Unknown scenario. Choose one of: {', '.join(SCENARIOS)}.")
    return {"key": key, **SCENARIOS[key]}


def reroute_threshold(q):
    """P(Blocked) at which Continue and Reroute have equal expected value."""
    gap_clear = q["Clear"]["Continue"] - q["Clear"]["Reroute"]      # Continue's lead when Clear
    gap_blocked = q["Blocked"]["Continue"] - q["Blocked"]["Reroute"]  # (negative) when Blocked
    if gap_clear == gap_blocked:
        return None
    p = gap_clear / (gap_clear - gap_blocked)
    return p if 0 <= p <= 1 else None


def _expansion(cell, g, h):
    return {"cell": cell, "g": g, "h": h, "f": g + h}


def simulate(scenario):
    """Run all five stages for one scenario and return the full trace."""
    start, goal = find(GRID, "S"), find(GRID, "H")

    # ---- 1. A*: fastest route, plus the two travel times the MDP needs
    # The traces record the order in which cells are expanded, so the website can replay the search.
    search_trace, bfs_trace, detour_trace = [], [], []
    fast_path, expanded = astar(GRID, start, goal, trace=search_trace)
    if fast_path is None:
        raise RuntimeError("No route from the start to the hospital.")
    fast_min = len(fast_path) - 1
    _, bfs_expanded = bfs(GRID, start, goal, trace=bfs_trace)   # baseline only, to show what the heuristic saves

    detour_path, detour_expanded = astar(GRID, start, goal, extra_blocked=[RISKY_ROAD], trace=detour_trace)
    if detour_path is None:
        raise RuntimeError("No detour exists around the risky road.")
    detour_min = len(detour_path) - 1

    turn_cell = fast_path[fast_path.index(RISKY_ROAD) - 1]
    minutes_to_turn = fast_path.index(turn_cell)
    back_path, _ = astar(GRID, turn_cell, goal, extra_blocked=[RISKY_ROAD])
    backtrack_min = minutes_to_turn + len(back_path) - 1

    # ---- 2. Viterbi: traffic state -> prior
    speeds = scenario["speeds"]
    hmm_path, hmm_prob, table = viterbi(speeds, HMM_STATES, HMM_START, HMM_TRANS, HMM_EMIT)
    traffic_now = hmm_path[-1]
    prior = PRIOR_BLOCKED[traffic_now]

    # ---- 3. Bayes: prior + sensor -> posterior
    alert = scenario["alert"]
    p_blocked, bayes_steps = posterior_blocked(prior, P_ALERT_IF_BLOCKED, P_ALERT_IF_CLEAR, alert)

    # ---- 4. MDP: posterior + travel times -> action
    rewards = build_rewards(fast_min, detour_min, backtrack_min)
    q = bellman_q(MDP_TRANS, rewards, GAMMA)
    action, expected = decide(p_blocked, q)

    # ---- 5. Final route (A* re-plan if the MDP says Reroute)
    rerouted = action == "Reroute"
    final_path = detour_path if rerouted else fast_path

    return {
        "scenario": scenario,
        "astar": {
            "path": fast_path,
            "expanded": expanded,
            "bfs_expanded": bfs_expanded,
            "minutes": fast_min,
            "uses_risky": RISKY_ROAD in fast_path,
            "detour_path": detour_path,
            "detour_expanded": detour_expanded,
            "detour_minutes": detour_min,
            "turn_cell": turn_cell,
            "minutes_to_turn": minutes_to_turn,
            "backtrack_minutes": backtrack_min,
            # drive to the cell before the risky road, find it blocked, then follow the A* route back
            "turn_back_path": fast_path[:minutes_to_turn + 1] + back_path[1:],
            "search": [_expansion(c, g, h) for c, g, h in search_trace],
            "detour_search": [_expansion(c, g, h) for c, g, h in detour_trace],
            "bfs_search": bfs_trace,
        },
        "viterbi": {
            "observations": speeds,
            "table": table,
            "path": hmm_path,
            "probability": hmm_prob,
            "traffic_now": traffic_now,
            "prior": prior,
        },
        "bayes": {
            "prior": prior,
            "alert": alert,
            "steps": bayes_steps,
            "posterior": p_blocked,
        },
        "mdp": {
            "rewards": rewards,
            "q": q,
            "belief": {"Clear": 1 - p_blocked, "Blocked": p_blocked},
            "expected": expected,
            "action": action,
            "threshold": reroute_threshold(q),
        },
        "final": {
            "action": action,
            "rerouted": rerouted,
            "path": final_path,
            "minutes": len(final_path) - 1,
        },
    }


def config():
    """Everything the website needs to draw the map and list the assumptions."""
    return {
        "grid": GRID,
        "start": find(GRID, "S"),
        "goal": find(GRID, "H"),
        "risky_road": RISKY_ROAD,
        "scenarios": [{"key": k, **v} for k, v in SCENARIOS.items()],
        "speed_values": SPEED_VALUES,
        "n_reports": N_REPORTS,
        "hmm": {
            "states": HMM_STATES,
            "start": HMM_START,
            "transitions": HMM_TRANS,
            "emissions": HMM_EMIT,
            "prior_blocked": PRIOR_BLOCKED,
        },
        "sensor": {
            "p_alert_if_blocked": P_ALERT_IF_BLOCKED,
            "p_alert_if_clear": P_ALERT_IF_CLEAR,
        },
        "mdp": {
            "states": STATES,
            "actions": ACTIONS,
            "road_dynamics": MDP_TRANS["Continue"],
            "gamma": GAMMA,
        },
    }
