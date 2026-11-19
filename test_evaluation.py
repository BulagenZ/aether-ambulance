"""Deeper correctness checks and the evaluation results. Run:  python -m unittest -v"""
import itertools
import random
import unittest

from app import app
from astar import astar
from bayes import posterior_blocked
from bfs import bfs
from evaluate import all_inputs, policy_comparison, search_comparison
from main import HMM_EMIT, HMM_START, HMM_STATES, HMM_TRANS, SCENARIOS
from mdp import decide
from pipeline import resolve_scenario, simulate
from viterbi import viterbi


def random_map(rng, size=6, wall_rate=0.3):
    """A random size x size map with walls, plus a random start and goal on free cells."""
    grid = [["#" if rng.random() < wall_rate else "." for _ in range(size)] for _ in range(size)]
    free = [(r, c) for r in range(size) for c in range(size) if grid[r][c] == "."]
    start, goal = rng.sample(free, 2)
    return ["".join(row) for row in grid], start, goal


class TestSearchCorrectness(unittest.TestCase):
    def test_astar_is_optimal_on_300_random_maps(self):
        """BFS is guaranteed shortest on unit-cost grids, so A* must match its route length."""
        rng = random.Random(2026)
        for i in range(300):
            grid, start, goal = random_map(rng)
            a_path, a_expanded = astar(grid, start, goal)
            b_path, b_expanded = bfs(grid, start, goal)
            with self.subTest(map=i):
                if b_path is None:
                    self.assertIsNone(a_path)
                    continue
                self.assertEqual(len(a_path), len(b_path))
                self.assertEqual((a_path[0], a_path[-1]), (start, goal))
                for (r1, c1), (r2, c2) in zip(a_path, a_path[1:]):
                    self.assertEqual(abs(r1 - r2) + abs(c1 - c2), 1)
                    self.assertNotEqual(grid[r2][c2], "#")

    def test_astar_never_expands_more_than_bfs_here(self):
        for row in search_comparison():
            self.assertEqual(row["astar_minutes"], row["bfs_minutes"])
            self.assertLessEqual(row["astar_expanded"], row["bfs_expanded"])


class TestViterbiCorrectness(unittest.TestCase):
    def test_matches_brute_force_for_every_observation_sequence(self):
        """Check every one of the 2^3 state sequences by hand and keep the most likely."""
        for obs in itertools.product(("fast", "slow"), repeat=3):
            best_seq, best_p = None, -1.0
            for seq in itertools.product(HMM_STATES, repeat=3):
                p = HMM_START[seq[0]] * HMM_EMIT[seq[0]][obs[0]]
                for t in range(1, 3):
                    p *= HMM_TRANS[seq[t - 1]][seq[t]] * HMM_EMIT[seq[t]][obs[t]]
                if p > best_p:
                    best_seq, best_p = list(seq), p
            path, prob, _ = viterbi(list(obs), HMM_STATES, HMM_START, HMM_TRANS, HMM_EMIT)
            with self.subTest(obs=obs):
                self.assertEqual(path, best_seq)
                self.assertAlmostEqual(prob, best_p)


class TestBayesProperties(unittest.TestCase):
    def test_posteriors_sum_to_one_and_move_the_right_way(self):
        for prior in (0.01, 0.1, 0.25, 0.4, 0.5, 0.75, 0.99):
            for alert in (True, False):
                p, s = posterior_blocked(prior, 0.9, 0.1, alert)
                with self.subTest(prior=prior, alert=alert):
                    self.assertAlmostEqual(p + s["joint_clear"] / s["evidence"], 1.0)
                    if alert:
                        self.assertGreater(p, prior)
                    else:
                        self.assertLess(p, prior)

    def test_useless_sensor_does_not_change_belief(self):
        p, _ = posterior_blocked(0.3, 0.5, 0.5, alert=True)
        self.assertAlmostEqual(p, 0.3)


class TestDecisionThreshold(unittest.TestCase):
    def test_decision_flips_exactly_at_threshold(self):
        result = simulate(resolve_scenario({"scenario": "rush"}))
        threshold = result["mdp"]["threshold"]
        q = result["mdp"]["q"]
        self.assertEqual(decide(threshold - 1e-6, q)[0], "Continue")
        self.assertEqual(decide(threshold + 1e-6, q)[0], "Reroute")


class TestEvaluation(unittest.TestCase):
    def test_every_input_is_covered_once(self):
        rows = all_inputs()
        self.assertEqual(len(rows), 16)
        self.assertEqual(len({(tuple(r["speeds"]), r["alert"]) for r in rows}), 16)
        self.assertEqual({r["action"] for r in rows}, {"Continue", "Reroute"})

    def test_preset_scenarios_appear_with_the_same_decision(self):
        rows = {(tuple(r["speeds"]), r["alert"]): r["action"] for r in all_inputs()}
        for key, sc in SCENARIOS.items():
            expected = simulate(resolve_scenario({"scenario": key}))["final"]["action"]
            self.assertEqual(rows[(tuple(sc["speeds"]), sc["alert"])], expected)

    def test_aether_beats_every_simple_rule(self):
        for seed in (7, 11, 2026):
            with self.subTest(seed=seed):
                results = {r["policy"]: r["mean_minutes"] for r in policy_comparison(seed=seed)}
                for baseline in ("Always continue", "Always reroute", "Trust the sensor"):
                    self.assertLess(results["AETHER"], results[baseline])
                self.assertLessEqual(results["Perfect knowledge"], results["AETHER"])

    def test_simulation_is_reproducible(self):
        self.assertEqual(policy_comparison(trials=500, seed=3), policy_comparison(trials=500, seed=3))


class TestEvaluateApi(unittest.TestCase):
    def test_evaluate_endpoint(self):
        data = app.test_client().get("/api/evaluate").get_json()
        self.assertEqual(set(data), {"search", "inputs", "policies", "trials", "seed"})
        self.assertEqual(len(data["inputs"]), 16)
        self.assertEqual(data["policies"][0]["policy"], "AETHER")

    def test_simulation_reports_bfs_baseline(self):
        data = app.test_client().post("/api/simulate", json={"scenario": "calm"}).get_json()
        self.assertGreaterEqual(data["astar"]["bfs_expanded"], data["astar"]["expanded"])


if __name__ == "__main__":
    unittest.main()
