"""Viterbi algorithm for a Hidden Markov Model (topic: reasoning over time).

Hidden state: the traffic on the road (Flowing / Jammed) - we cannot see it directly.
Observation:  the speed report of each passing car (fast / slow) - noisy evidence.
"""


def viterbi(observations, states, start_p, trans_p, emit_p):
    """Return (best_path, best_probability, table).

    table[t][s] = probability of the most likely state sequence that ends in state s at time t.
    """
    table = [{s: start_p[s] * emit_p[s][observations[0]] for s in states}]
    back = [{}]

    for t in range(1, len(observations)):
        table.append({})
        back.append({})
        for s in states:
            # Which previous state gives the best way of arriving in s?
            prev = max(states, key=lambda p: table[t - 1][p] * trans_p[p][s])
            table[t][s] = table[t - 1][prev] * trans_p[prev][s] * emit_p[s][observations[t]]
            back[t][s] = prev

    # Backtrack from the best final state.
    last = max(states, key=lambda s: table[-1][s])
    path = [last]
    for t in range(len(observations) - 1, 0, -1):
        path.append(back[t][path[-1]])
    path.reverse()
    return path, table[-1][last], table
