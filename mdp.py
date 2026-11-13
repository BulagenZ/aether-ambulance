"""A two-state, two-action MDP: Continue on the fast road or Reroute? (topic: sequential decision making)

States  : the road is Clear or Blocked.
Actions : Continue (drive into the fast road) or Reroute (take the long detour now).
T(s'|s) : the road can change before the ambulance arrives (a jam forms, or a crew clears it).
R(a,s') : minus the travel time in minutes, so maximising reward = minimising time.
"""

STATES = ("Clear", "Blocked")
ACTIONS = ("Continue", "Reroute")


def build_rewards(fast_minutes, detour_minutes, backtrack_minutes):
    """Rewards come straight from the A* route lengths, which is what ties the two algorithms together."""
    return {
        "Continue": {"Clear": -fast_minutes, "Blocked": -backtrack_minutes},
        "Reroute": {"Clear": -detour_minutes, "Blocked": -detour_minutes},
    }


def bellman_q(transitions, rewards, gamma=0.9, values=None):
    """One Bellman update:  Q(s,a) = sum over s' of T(s'|s,a) * [ R(a,s') + gamma * V(s') ].

    values defaults to V = 0 everywhere (the trip ends after this decision).
    """
    values = values or {s: 0.0 for s in STATES}
    q = {}
    for s in STATES:
        q[s] = {}
        for a in ACTIONS:
            q[s][a] = sum(
                transitions[a][s][s2] * (rewards[a][s2] + gamma * values[s2]) for s2 in STATES
            )
    return q


def decide(p_blocked, q):
    """We do not know the state for sure, so weight Q(s,a) by the belief from Bayes and pick the best action."""
    belief = {"Clear": 1 - p_blocked, "Blocked": p_blocked}
    expected = {a: sum(belief[s] * q[s][a] for s in STATES) for a in ACTIONS}
    best = max(ACTIONS, key=lambda a: expected[a])
    return best, expected
