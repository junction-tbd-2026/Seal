import contextlib
import io
import os
import unittest
from unittest import mock

from reviewer_controls.matcher import finding_hits_plant, missed_regions, score_plant
from reviewer_controls.models import KIND_BUG, KIND_HARMLESS, Finding, Plant
from reviewer_controls.pipeline import main
from reviewer_controls.stats import floor_if_all_caught, plants_needed_for_floor, wilson_interval


def plant(kind=KIND_BUG, plant_id="p1"):
    return Plant(id=plant_id, kind=kind, description="x", file="src/Foo.cs", line_start=40, line_end=42)


def finding(file="src/Foo.cs", start=41, end=41):
    return Finding(file=file, line_start=start, line_end=end, message="m")


class MatcherTests(unittest.TestCase):
    def test_hit_inside_range(self):
        self.assertTrue(finding_hits_plant(finding(), plant()))

    def test_hit_within_tolerance(self):
        self.assertTrue(finding_hits_plant(finding(start=45, end=45), plant()))

    def test_miss_outside_tolerance(self):
        self.assertFalse(finding_hits_plant(finding(start=46, end=50), plant()))

    def test_miss_other_file(self):
        self.assertFalse(finding_hits_plant(finding(file="src/Bar.cs"), plant()))

    def test_path_prefix_differences_still_match(self):
        self.assertTrue(finding_hits_plant(finding(file="./src/Foo.cs"), plant()))
        self.assertTrue(finding_hits_plant(finding(file="Foo.cs"), plant()))

    def test_bug_flagged_is_correct(self):
        outcome = score_plant(plant(), [finding()], reviewer="r")
        self.assertTrue(outcome.flagged)
        self.assertTrue(outcome.correct)

    def test_bug_not_flagged_is_wrong(self):
        outcome = score_plant(plant(), [], reviewer="r")
        self.assertFalse(outcome.correct)

    def test_harmless_edit_flagged_is_a_false_alarm(self):
        outcome = score_plant(plant(kind=KIND_HARMLESS), [finding()], reviewer="r")
        self.assertTrue(outcome.flagged)
        self.assertFalse(outcome.correct)

    def test_harmless_edit_left_alone_is_correct(self):
        outcome = score_plant(plant(kind=KIND_HARMLESS), [], reviewer="r")
        self.assertTrue(outcome.correct)

    def test_missed_regions_lists_only_missed_bugs(self):
        plants = [plant(plant_id="a"), plant(plant_id="b"), plant(kind=KIND_HARMLESS, plant_id="c")]
        outcomes = [
            score_plant(plants[0], [finding()], "r"),   # caught
            score_plant(plants[1], [], "r"),            # missed
            score_plant(plants[2], [finding()], "r"),   # false alarm, not a region to read
        ]
        self.assertEqual([p.id for p in missed_regions(plants, outcomes)], ["b"])


class StatsTests(unittest.TestCase):
    def test_floor_values(self):
        self.assertAlmostEqual(floor_if_all_caught(10), 0.741, places=3)
        self.assertAlmostEqual(floor_if_all_caught(20), 0.861, places=3)
        self.assertAlmostEqual(floor_if_all_caught(30), 0.905, places=3)

    def test_plants_needed(self):
        self.assertEqual(plants_needed_for_floor(0.90), 29)
        self.assertEqual(plants_needed_for_floor(0.74), 10)

    def test_wilson_interval_is_wide_for_ten(self):
        low, high = wilson_interval(9, 10)
        self.assertLess(low, 0.60)
        self.assertGreater(high, 0.97)

    def test_wilson_interval_narrows_with_more_samples(self):
        low, high = wilson_interval(180, 200)
        self.assertLess(high - low, 0.09)

    def test_invalid_inputs(self):
        with self.assertRaises(ValueError):
            wilson_interval(1, 0)
        with self.assertRaises(ValueError):
            wilson_interval(11, 10)
        with self.assertRaises(ValueError):
            floor_if_all_caught(0)


class PipelineTests(unittest.TestCase):
    """Runs the command with no keys file and no key variables, whatever the machine has."""

    def setUp(self):
        cleared = {name: "" for name in os.environ if name.startswith(("PLANTER_", "REVIEWER_"))}
        cleared["JUNCTION_KEYS_FILE"] = "/nonexistent/keys.env"
        patcher = mock.patch.dict(os.environ, cleared)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_quietly(self, argv):
        with contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()) as err:
            code = main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_dry_run_succeeds_and_reports_settings_without_values(self):
        code, out, _ = self.run_quietly(["--change", "ju26-issue-2283", "--dry-run"])
        self.assertEqual(code, 0)
        self.assertIn("REVIEWER_API_KEY missing", out)

    def test_real_run_without_keys_fails_cleanly(self):
        code, _, err = self.run_quietly(["--change", "ju26-issue-2283"])
        self.assertEqual(code, 2)
        self.assertIn("is not set", err)

    def test_rejects_zero_plants(self):
        code, _, _ = self.run_quietly(["--change", "x", "--plants", "0", "--dry-run"])
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()


class RefusedRequestTests(unittest.TestCase):
    def test_an_error_body_instead_of_a_reply_is_retried_and_explained(self):
        import json as _json
        from reviewer_controls.llm import ChatClient, ModelError

        class Reply:
            def __init__(self, body):
                self.body = body

            def read(self):
                return _json.dumps(self.body).encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        replies = iter([
            Reply({"error": {"message": "Concurrency limit reached for key-SECRETVALUE"}}),
            Reply({"choices": [{"message": {"content": "fine"}, "finish_reason": "stop"}], "usage": {}}),
        ])
        client = ChatClient("https://example.invalid/v1", "m", "key-SECRETVALUE", max_retries=2)
        with mock.patch("urllib.request.urlopen", lambda *a, **k: next(replies)), mock.patch("time.sleep"):
            self.assertEqual(client.complete("s", "u").text, "fine")

        always = ChatClient("https://example.invalid/v1", "m", "key-SECRETVALUE", max_retries=1)
        refused = lambda *a, **k: Reply({"error": "Concurrency limit reached for key-SECRETVALUE"})
        with mock.patch("urllib.request.urlopen", refused), mock.patch("time.sleep"):
            with self.assertRaises(ModelError) as caught:
                always.complete("s", "u")
        self.assertIn("refused the request", str(caught.exception))
        self.assertNotIn("SECRETVALUE", str(caught.exception))
