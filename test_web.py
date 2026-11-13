"""Tests for the website backend. Run:  python -m unittest -v"""
import unittest

from app import app
from main import RISKY_ROAD, SCENARIOS, run
from pipeline import simulate, resolve_scenario


class TestPipelineMatchesOriginal(unittest.TestCase):
    """The website must give exactly the same results as the console program."""

    def test_all_scenarios_match_main(self):
        for key in SCENARIOS:
            with self.subTest(scenario=key):
                original = run(SCENARIOS[key], verbose=False)
                web = simulate(resolve_scenario({"scenario": key}))
                self.assertEqual(web["astar"]["minutes"], original["fast_min"])
                self.assertEqual(web["astar"]["detour_minutes"], original["detour_min"])
                self.assertEqual(web["astar"]["backtrack_minutes"], original["backtrack_min"])
                self.assertEqual(web["viterbi"]["path"], original["traffic"])
                self.assertEqual(web["viterbi"]["prior"], original["prior"])
                self.assertEqual(web["bayes"]["posterior"], original["p_blocked"])
                self.assertEqual(web["mdp"]["expected"], original["expected"])
                self.assertEqual(web["final"]["action"], original["action"])
                self.assertEqual(web["final"]["path"], original["final_path"])

    def test_threshold_separates_the_two_actions(self):
        result = simulate(resolve_scenario({"scenario": "rush"}))
        self.assertAlmostEqual(result["mdp"]["threshold"], 8.6 / 11.2)


class TestApi(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def post(self, body):
        return self.client.post("/api/simulate", json=body)

    def test_home_page_loads(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"AETHER", response.data)

    def test_static_files_load(self):
        for path in ("/static/app.js", "/static/style.css"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            response.close()

    def test_config_lists_three_scenarios_and_grid(self):
        data = self.client.get("/api/config").get_json()
        self.assertEqual([s["key"] for s in data["scenarios"]], ["rush", "calm", "mixed"])
        self.assertEqual(len(data["grid"]), 6)
        self.assertEqual(data["risky_road"], list(RISKY_ROAD))

    def test_rush_reroutes(self):
        data = self.post({"scenario": "rush"}).get_json()
        self.assertEqual(data["final"]["action"], "Reroute")
        self.assertEqual(data["final"]["minutes"], 15)
        self.assertNotIn(list(RISKY_ROAD), data["final"]["path"])
        self.assertAlmostEqual(data["bayes"]["posterior"], 0.36 / 0.42)

    def test_calm_continues(self):
        data = self.post({"scenario": "calm"}).get_json()
        self.assertEqual(data["final"]["action"], "Continue")
        self.assertEqual(data["final"]["minutes"], 5)

    def test_mixed_continues(self):
        data = self.post({"scenario": "mixed"}).get_json()
        self.assertEqual(data["viterbi"]["traffic_now"], "Jammed")
        self.assertEqual(data["final"]["action"], "Continue")

    def test_custom_scenario_equal_to_rush_gives_same_answer(self):
        custom = self.post({"custom": {"speeds": ["fast", "slow", "slow"], "alert": True}}).get_json()
        rush = self.post({"scenario": "rush"}).get_json()
        self.assertEqual(custom["mdp"], rush["mdp"])
        self.assertEqual(custom["final"], rush["final"])

    def test_bad_requests_return_400_with_message(self):
        bad_bodies = [
            {"scenario": "storm"},
            {},
            {"custom": {"speeds": ["fast", "slow"], "alert": True}},
            {"custom": {"speeds": ["fast", "slow", "medium"], "alert": True}},
            {"custom": {"speeds": ["fast", "slow", "slow"], "alert": "yes"}},
            {"custom": "rush"},
            ["rush"],
        ]
        for body in bad_bodies:
            with self.subTest(body=body):
                response = self.post(body)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.get_json()["error"])

    def test_non_json_body_returns_400(self):
        response = self.client.post("/api/simulate", data="not json", content_type="text/plain")
        self.assertEqual(response.status_code, 400)

    def test_unknown_api_path_returns_json_404(self):
        response = self.client.get("/api/nothing")
        self.assertEqual(response.status_code, 404)
        self.assertTrue(response.get_json()["error"])

    def test_wrong_method_returns_json_405(self):
        response = self.client.get("/api/simulate")
        self.assertEqual(response.status_code, 405)
        self.assertTrue(response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
