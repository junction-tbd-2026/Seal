import json
import tempfile
import unittest
from pathlib import Path

from reviewer_controls import vigilance as vigilance_module
from reviewer_controls.exam import build_exam
from reviewer_controls.vigilance import Vigilance, pick_spot_check

REAL = (
    "diff --git a/src/A.cs b/src/A.cs\n--- a/src/A.cs\n+++ b/src/A.cs\n"
    "@@ -10,2 +10,3 @@\n keep\n+if (value > max)\n keep2\n"
)
PLANTED = REAL.replace("value > max", "value < max")


def plant(plant_id, kind, breaks=None):
    return {"id": plant_id, "kind": kind, "difficulty": "medium", "description": "d-" + plant_id, "file": "src/A.cs",
            "line_start": 11, "line_end": 11, "patch": PLANTED, "breaks": breaks}


def run(reviewer, created_at, plants, caught_ids):
    reviews, outcomes = [], []
    for p in plants:
        hit = p["id"] in caught_ids
        reviews.append({"reviewer": reviewer, "variant_id": p["id"], "error": "", "findings": []})
        outcomes.append({"plant_id": p["id"], "kind": p["kind"], "reviewer": reviewer, "flagged": hit,
                         "correct": hit == (p["kind"] != "harmless"), "inconclusive": False,
                         "point_link": "confirmed" if p.get("breaks") else None})
    return {
        "change": {"id": "c1", "requirement_id": "1", "base_ref": "b", "head_ref": "h", "diff": REAL,
                   "requirement_text": "# Requirement #1: Clamp\n\nBody.\n"},
        "reviewer": reviewer, "planter": "planter", "created_at": created_at, "plants": plants,
        "requirement_points": [{"id": "R1", "text": "Values above max come back as max."}],
        "original_review": {"meets_requirement": True, "findings": [], "refused_to_decide": [], "error": "",
                            "points": [{"id": "R1", "status": "met", "reason": "the clamp",
                                        "evidence": [{"file": "src/A.cs", "line_start": 11, "line_end": 11}]}]},
        "variant_reviews": reviews, "outcomes": outcomes, "requirement_flip_changed_verdict": True,
        "prompt_tokens": 1, "completion_tokens": 1, "wall_seconds": 1.0, "notes": [], "build_checked": False,
    }


class VigilanceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.results = Path(self.folder.name)
        self.plants = [plant("p01", "bug", "R1"), plant("p02", "omission", "R1"), plant("p03", "harmless")]
        (self.results / "big.json").write_text(json.dumps(run("big", "2026-11-14T03:00:00Z", self.plants, {"p01"})))
        (self.results / "small.json").write_text(json.dumps(run("small", "2026-11-14T03:05:00Z", self.plants, set())))
        saved = [dict(p, variant_diff=PLANTED) for p in self.plants]
        (self.results / "c1__plants__x.json").write_text(json.dumps({"change_id": "c1", "plants": saved}))

    def shown(self, exam):
        return [row["text"] for row in exam["change"]["files"][0]["rows"] if row["kind"] == "add"]

    def test_requirement_points_carry_evidence_and_whether_a_break_was_noticed(self):
        exam = build_exam(self.results, "c1")
        big, small = exam["reviewers"]
        self.assertEqual(exam["requirement_points"], [{"id": "R1", "text": "Values above max come back as max."}])
        self.assertEqual((big["points"][0]["status"], big["points"][0]["evidence"][0]["line_start"]), ("met", 11))
        self.assertEqual((big["points"][0]["broken_noticed"], big["points"][0]["broken_total"], big["points"][0]["noticed"]),
                         (1, 2, "partly"))
        self.assertEqual(big["points"][0]["missed_plants"], ["p02"])
        self.assertEqual(small["points"][0]["noticed"], "no")

    def test_spot_check_uses_a_defect_every_reviewer_missed(self):
        self.assertEqual(pick_spot_check(build_exam(self.results, "c1"))["id"], "p02")

    def test_first_opening_shows_a_planted_copy_and_never_says_so(self):
        vigilance = Vigilance(self.results)
        first = vigilance.open("c1")
        self.assertEqual(self.shown(first), ["if (value < max)"])
        real = build_exam(self.results, "c1")
        self.assertEqual(set(first) - {"session"}, set(real))             # same shape as the real thing
        self.assertNotIn("spot_check", json.dumps(first))
        again = vigilance.open("c1")
        self.assertEqual(self.shown(again), ["if (value < max)"])         # a reload does not use it up
        self.assertNotEqual(first["session"], again["session"])
        vigilance.sign(again["session"], "big", "Ada", "reject")
        self.assertEqual(self.shown(vigilance.open("c1")), ["if (value < max)"])   # the server remembers nothing
        self.assertEqual(self.shown(vigilance.open("c1", checked=True)), ["if (value > max)"])   # the browser says it was checked

    def test_accepting_a_planted_copy_is_recorded_as_a_miss_and_not_as_an_approval(self):
        vigilance = Vigilance(self.results)
        result = vigilance.sign(vigilance.open("c1")["session"], "big", "Ada", "accept")
        self.assertEqual((result["spot_check"], result["change_id"], result["caught"], result["plant"]["id"]), (True, "c1", False, "p02"))
        self.assertNotIn("signoff", result)

        real = vigilance.sign(vigilance.open("c1", checked=True)["session"], "big", "Ada", "accept")
        self.assertFalse(real["spot_check"])
        self.assertEqual((real["signoff"]["change_id"], real["signoff"]["name"], real["signoff"]["decision"]), ("c1", "Ada", "accept"))

    def test_nothing_about_people_is_written(self):
        before = sorted(path.name for path in self.results.iterdir())
        vigilance = Vigilance(self.results)
        vigilance.sign(vigilance.open("c1", "browser-a")["session"], "big", "Ada", "accept")
        vigilance.sign(vigilance.open("c1", "browser-a", checked=True)["session"], "big", "Ada", "accept")
        self.assertEqual(sorted(path.name for path in self.results.iterdir()), before)
        # Another browser is untouched by what the first one did.
        self.assertEqual(self.shown(vigilance.open("c1", "browser-b")), ["if (value < max)"])

    def test_marking_the_planted_spot_as_wrong_is_recorded(self):
        vigilance = Vigilance(self.results)
        spots = [{"plant_id": "p02", "verdict": "wrong"}, {"plant_id": "p01", "verdict": "right"}, {"plant_id": "x", "verdict": "?"}]
        result = vigilance.sign(vigilance.open("c1")["session"], "big", "Grace", "reject", spots)
        self.assertEqual((result["caught"], result["spotted"]), (True, True))
        missed = Vigilance(self.results)
        result = missed.sign(missed.open("c1")["session"], "big", "Bob", "reject", [{"plant_id": "p02", "verdict": "right"}])
        self.assertEqual((result["caught"], result["spotted"]), (True, False))   # refused it, but called the planted spot right
        same_lines = Vigilance(self.results)
        result = same_lines.sign(same_lines.open("c1")["session"], "big", "Eve", "reject", [{"plant_id": "p01", "verdict": "wrong"}])
        self.assertEqual((result["caught"], result["spotted"]), (True, True))    # another planted edit on the same lines is the same place

    def test_spot_verdicts_are_kept_with_a_real_sign_off(self):
        vigilance = Vigilance(self.results, enabled=False)
        spots = [{"plant_id": "p02", "verdict": "right"}, {"plant_id": "p01", "verdict": "nonsense"}]
        result = vigilance.sign(vigilance.open("c1")["session"], "big", "Ada", "accept", spots)
        self.assertEqual(result["signoff"]["spots"], [{"plant_id": "p02", "verdict": "right"}])

    def test_proof_that_is_only_a_test_is_flagged(self):
        data = run("big", "2026-11-14T05:00:00Z", self.plants, set())
        data["original_review"]["points"][0]["evidence"] = [{"file": "tests/ATests.cs", "line_start": 3, "line_end": 4}]
        (self.results / "big.json").write_text(json.dumps(data))
        big = [r for r in build_exam(self.results, "c1")["reviewers"] if r["name"] == "big"][0]
        self.assertTrue(big["points"][0]["tests_only"])

    def test_rejecting_a_planted_copy_counts_as_a_catch(self):
        vigilance = Vigilance(self.results)
        result = vigilance.sign(vigilance.open("c1")["session"], "big", "Grace", "full_read")
        self.assertTrue(result["caught"])

    def test_a_session_signs_once_and_an_empty_name_decides_nothing(self):
        vigilance = Vigilance(self.results)
        token = vigilance.open("c1")["session"]
        with self.assertRaises(ValueError):
            vigilance.sign(token, "big", "  ", "accept")
        vigilance.sign(token, "big", "Ada", "reject")
        with self.assertRaises(KeyError):
            vigilance.sign(token, "big", "Ada", "reject")
        off = Vigilance(self.results, enabled=False)
        real = off.open("c1")["session"]
        with self.assertRaises(ValueError):
            off.sign(real, "big", "Ada", "maybe")
        self.assertEqual(off.sign(real, "big", "Ada", "reject")["signoff"]["decision"], "reject")   # still open after a refusal

    def test_spot_checks_can_be_switched_off(self):
        off = Vigilance(self.results, enabled=False)
        self.assertEqual(self.shown(off.open("c1")), ["if (value > max)"])

    def test_only_a_share_of_pull_requests_is_spot_checked_and_the_choice_sticks(self):
        vigilance = Vigilance(self.results, rate=0.5, secret=b"fixed")
        picked = [self.shown(vigilance.open("c1", "browser-{}".format(n)))[0] == "if (value < max)" for n in range(400)]
        self.assertTrue(120 < sum(picked) < 280)                                  # about half of the browsers
        for n in range(20):                                                       # and a reload never changes it
            first = self.shown(vigilance.open("c1", "browser-{}".format(n)))
            self.assertEqual(self.shown(vigilance.open("c1", "browser-{}".format(n))), first)
        never = Vigilance(self.results, rate=0)
        self.assertEqual(self.shown(never.open("c1", "anyone")), ["if (value > max)"])

    def test_old_and_surplus_sessions_are_dropped(self):
        saved = vigilance_module.MAX_SESSIONS
        vigilance_module.MAX_SESSIONS = 2
        self.addCleanup(setattr, vigilance_module, "MAX_SESSIONS", saved)
        vigilance = Vigilance(self.results, enabled=False)
        oldest, middle, newest = (vigilance.open("c1")["session"] for _ in range(3))
        with self.assertRaises(KeyError):
            vigilance.sign(oldest, "big", "Ada", "accept")
        vigilance.sign(newest, "big", "Ada", "accept")
        vigilance.sign(middle, "big", "Ada", "accept")

    def test_points_only_count_breaks_inside_the_lines_the_reviewer_cited(self):
        data = run("big", "2026-11-14T04:00:00Z", self.plants, set())
        data["outcomes"][0]["point_link"] = "unconfirmed"
        data["unstable_points"] = []
        (self.results / "big.json").write_text(json.dumps(data))
        big = lambda: [r for r in build_exam(self.results, "c1")["reviewers"] if r["name"] == "big"][0]["points"][0]
        point = big()
        self.assertEqual((point["broken_total"], point["aimed_elsewhere"], point["noticed"]), (1, 1, "no"))
        data["unstable_points"] = ["R1"]
        (self.results / "big.json").write_text(json.dumps(data))
        self.assertEqual(big()["noticed"], "unstable")

    def test_without_a_saved_planted_copy_the_real_change_is_shown(self):
        (self.results / "c1__plants__x.json").unlink()
        self.assertEqual(self.shown(Vigilance(self.results).open("c1")), ["if (value > max)"])
        self.assertIsNone(Vigilance(self.results).open("unknown"))


if __name__ == "__main__":
    unittest.main()
