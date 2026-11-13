"""Test cases. Run:  python -m unittest -v"""
import unittest

from astar import astar, find
from bayes import posterior_blocked
from main import GRID, RISKY_ROAD, SCENARIOS, run
from mdp import bellman_q, build_rewards, decide
from viterbi import viterbi


class TestAStar(unittest.TestCase):
    def test_shortest_route_is_five_minutes(self):
        path, _ = astar(GRID, find(GRID, "S"), find(GRID, "H"))
        self.assertEqual(len(path) - 1, 5)
        self.assertIn(RISKY_ROAD, path)

    def test_detour_avoids_blocked_road(self):
        path, _ = astar(GRID, find(GRID, "S"), find(GRID, "H"), extra_blocked=[RISKY_ROAD])
        self.assertEqual(len(path) - 1, 15)
        self.assertNotIn(RISKY_ROAD, path)

    def test_path_is_connected_and_avoids_walls(self):
        path, _ = astar(GRID, find(GRID, "S"), find(GRID, "H"), extra_blocked=[RISKY_ROAD])
        for (r1, c1), (r2, c2) in zip(path, path[1:]):
            self.assertEqual(abs(r1 - r2) + abs(c1 - c2), 1)
            self.assertNotEqual(GRID[r2][c2], "#")

    def test_no_route_returns_none(self):
        path, _ = astar(["S#H"], (0, 0), (0, 2))
        self.assertIsNone(path)


class TestBayes(unittest.TestCase):
    def test_alert_raises_belief(self):
        # 0.9*0.4 / (0.9*0.4 + 0.1*0.6) = 0.36 / 0.42
        p, _ = posterior_blocked(0.4, 0.9, 0.1, alert=True)
        self.assertAlmostEqual(p, 0.36 / 0.42)

    def test_silence_lowers_belief(self):
        # 0.1*0.4 / (0.1*0.4 + 0.9*0.6) = 0.04 / 0.58
        p, _ = posterior_blocked(0.4, 0.9, 0.1, alert=False)
        self.assertAlmostEqual(p, 0.04 / 0.58)


class TestViterbi(unittest.TestCase):
    STATES = ("Flowing", "Jammed")
    START = {"Flowing": 0.6, "Jammed": 0.4}
    TRANS = {"Flowing": {"Flowing": 0.7, "Jammed": 0.3}, "Jammed": {"Flowing": 0.2, "Jammed": 0.8}}
    EMIT = {"Flowing": {"fast": 0.8, "slow": 0.2}, "Jammed": {"fast": 0.2, "slow": 0.8}}

    def test_hand_computed_sequence(self):
        path, prob, _ = viterbi(["fast", "slow", "slow"], self.STATES, self.START, self.TRANS, self.EMIT)
        self.assertEqual(path, ["Flowing", "Jammed", "Jammed"])
        # 0.6*0.8 * 0.3*0.8 * 0.8*0.8
        self.assertAlmostEqual(prob, 0.073728)

    def test_all_fast_means_flowing(self):
        path, _, _ = viterbi(["fast"] * 3, self.STATES, self.START, self.TRANS, self.EMIT)
        self.assertEqual(path, ["Flowing"] * 3)


class TestMDP(unittest.TestCase):
    DYN = {"Clear": {"Clear": 0.9, "Blocked": 0.1}, "Blocked": {"Clear": 0.1, "Blocked": 0.9}}
    TRANS = {"Continue": DYN, "Reroute": DYN}

    def setUp(self):
        self.q = bellman_q(self.TRANS, build_rewards(5, 15, 19))

    def test_bellman_update(self):
        self.assertAlmostEqual(self.q["Clear"]["Continue"], 0.9 * -5 + 0.1 * -19)
        self.assertAlmostEqual(self.q["Blocked"]["Continue"], 0.1 * -5 + 0.9 * -19)
        self.assertAlmostEqual(self.q["Clear"]["Reroute"], -15)

    def test_continue_when_probably_clear(self):
        self.assertEqual(decide(0.05, self.q)[0], "Continue")

    def test_reroute_when_probably_blocked(self):
        self.assertEqual(decide(0.9, self.q)[0], "Reroute")


class TestWholePipeline(unittest.TestCase):
    def test_rush_hour_reroutes(self):
        result = run(SCENARIOS["rush"], verbose=False)
        self.assertEqual(result["action"], "Reroute")
        self.assertNotIn(RISKY_ROAD, result["final_path"])

    def test_quiet_night_continues(self):
        result = run(SCENARIOS["calm"], verbose=False)
        self.assertEqual(result["action"], "Continue")
        self.assertIn(RISKY_ROAD, result["final_path"])

    def test_silent_sensor_overrides_jam_history(self):
        result = run(SCENARIOS["mixed"], verbose=False)
        self.assertEqual(result["traffic"][-1], "Jammed")
        self.assertEqual(result["action"], "Continue")


if __name__ == "__main__":
    unittest.main()
