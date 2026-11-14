import json
import tempfile
import unittest
from pathlib import Path

from reviewer_controls.exam import build_exam, signoffs_for
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
                         "correct": hit == (p["kind"] != "harmless"), "inconclusive": False})
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
        self.assertEqual(self.shown(vigilance.open("c1")), ["if (value > max)"])   # once signed, the real change

    def test_accepting_a_planted_copy_is_recorded_as_a_miss_and_not_as_an_approval(self):
        vigilance = Vigilance(self.results)
        result = vigilance.sign(vigilance.open("c1")["session"], "big", "Ada", "accept")
        self.assertEqual((result["spot_check"], result["caught"], result["plant"]["id"]), (True, False, "p02"))
        self.assertEqual(signoffs_for(self.results, "c1"), [])
        self.assertEqual((result["record"]["checked"], result["record"]["caught"]), (1, 0))

        real = vigilance.sign(vigilance.open("c1")["session"], "big", "Ada", "accept")
        self.assertFalse(real["spot_check"])
        self.assertEqual([(e["name"], e["decision"]) for e in signoffs_for(self.results, "c1")], [("Ada", "accept")])

    def test_rejecting_a_planted_copy_counts_as_a_catch(self):
        vigilance = Vigilance(self.results)
        result = vigilance.sign(vigilance.open("c1")["session"], "big", "Grace", "full_read")
        self.assertTrue(result["caught"])
        self.assertEqual(vigilance.record()["caught"], 1)

    def test_a_session_signs_once_and_an_empty_name_decides_nothing(self):
        vigilance = Vigilance(self.results)
        token = vigilance.open("c1")["session"]
        with self.assertRaises(ValueError):
            vigilance.sign(token, "big", "  ", "accept")
        vigilance.sign(token, "big", "Ada", "reject")
        with self.assertRaises(KeyError):
            vigilance.sign(token, "big", "Ada", "reject")

    def test_spot_checks_can_be_switched_off_and_reset(self):
        off = Vigilance(self.results, enabled=False)
        self.assertEqual(self.shown(off.open("c1")), ["if (value > max)"])
        on = Vigilance(self.results)
        on.sign(on.open("c1")["session"], "big", "Ada", "accept")
        self.assertEqual(self.shown(on.open("c1")), ["if (value > max)"])
        on.reset()
        self.assertEqual(self.shown(on.open("c1")), ["if (value < max)"])

    def test_without_a_saved_planted_copy_the_real_change_is_shown(self):
        (self.results / "c1__plants__x.json").unlink()
        self.assertEqual(self.shown(Vigilance(self.results).open("c1")), ["if (value > max)"])
        self.assertIsNone(Vigilance(self.results).open("unknown"))


if __name__ == "__main__":
    unittest.main()
