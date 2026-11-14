import json
import tempfile
import unittest
from pathlib import Path

from reviewer_controls.exam import build_exam, signoffs_for
from reviewer_controls.objectives import record_approval
from reviewer_controls.vigilance import Vigilance, pick_spot_check

PROPOSED = [{"id": "R1", "text": "Values above max come back as max."}]
ALL_ANSWERED = {"spots": [{"plant_id": "p02", "verdict": "right"}], "points": {"R1": "met"}, "findings": {}}

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
        self.assertEqual(self.shown(vigilance.open("c1")), ["if (value > max)"])   # once signed, the real change

    def test_accepting_a_planted_copy_is_recorded_as_a_miss_and_not_as_an_approval(self):
        vigilance = Vigilance(self.results)
        result = vigilance.sign(vigilance.open("c1")["session"], "big", "Ada", "accept")
        self.assertEqual((result["spot_check"], result["caught"], result["plant"]["id"]), (True, False, "p02"))
        self.assertEqual(signoffs_for(self.results, "c1"), [])
        self.assertEqual((result["record"]["checked"], result["record"]["caught"]), (1, 0))

        with self.assertRaises(ValueError):    # the real change cannot be accepted before the objectives are approved
            vigilance.sign(vigilance.open("c1")["session"], "big", "Ada", "accept", **ALL_ANSWERED)
        record_approval(self.results, "c1", PROPOSED, "Pat (product owner)", [{"id": "R1", "decision": "keep"}])
        real = vigilance.sign(vigilance.open("c1")["session"], "big", "Ada", "accept", **ALL_ANSWERED)
        self.assertFalse(real["spot_check"])
        self.assertEqual([(e["name"], e["decision"]) for e in signoffs_for(self.results, "c1")], [("Ada", "accept")])

    def test_marking_the_planted_spot_as_wrong_is_recorded(self):
        vigilance = Vigilance(self.results)
        spots = [{"plant_id": "p02", "verdict": "wrong"}, {"plant_id": "p01", "verdict": "right"}, {"plant_id": "x", "verdict": "?"}]
        result = vigilance.sign(vigilance.open("c1")["session"], "big", "Grace", "reject", spots)
        self.assertEqual((result["caught"], result["spotted"]), (True, True))
        missed = Vigilance(self.results)
        result = missed.sign(missed.open("c1")["session"], "big", "Bob", "reject", [{"plant_id": "p02", "verdict": "right"}])
        self.assertEqual((result["caught"], result["refused"], result["spotted"]), (False, True, False))   # refused it, but called the planted spot right
        same_lines = Vigilance(self.results)
        result = same_lines.sign(same_lines.open("c1")["session"], "big", "Eve", "reject", [{"plant_id": "p01", "verdict": "wrong"}])
        self.assertEqual((result["caught"], result["spotted"]), (True, True))    # another planted edit on the same lines is the same place

    def test_every_answer_is_kept_with_a_real_sign_off(self):
        record_approval(self.results, "c1", PROPOSED, "Pat", [{"id": "R1", "decision": "keep"}])
        vigilance = Vigilance(self.results, enabled=False)
        spots = [{"plant_id": "p02", "verdict": "right"}, {"plant_id": "p01", "verdict": "nonsense"}]
        vigilance.sign(vigilance.open("c1")["session"], "big", "Ada", "accept", spots, {"R1": "cannot_tell", "R9": "maybe"}, {})
        entry = signoffs_for(self.results, "c1")[0]
        self.assertEqual(entry["spots"], [{"plant_id": "p02", "verdict": "right"}])
        self.assertEqual(entry["points"], {"R1": "cannot_tell"})
        self.assertIsNotNone(entry["seconds"])

    def test_the_server_refuses_an_accept_the_page_should_not_have_allowed(self):
        record_approval(self.results, "c1", PROPOSED, "Pat", [{"id": "R1", "decision": "keep"}])
        vigilance = Vigilance(self.results, enabled=False)
        for spots, points in (([], {"R1": "met"}), ([{"plant_id": "p02", "verdict": "wrong"}], {"R1": "met"}),
                              ([{"plant_id": "p02", "verdict": "right"}], {}), ([{"plant_id": "p02", "verdict": "right"}], {"R1": "not_met"})):
            with self.assertRaises(ValueError):
                vigilance.sign(vigilance.open("c1")["session"], "big", "Ada", "accept", spots, points, {})
        self.assertEqual(signoffs_for(self.results, "c1"), [])
        vigilance.sign(vigilance.open("c1")["session"], "big", "Ada", "reject")   # rejecting needs none of it
        self.assertEqual(len(signoffs_for(self.results, "c1")), 1)

    def test_the_page_never_gets_the_text_of_a_planted_edit_it_asks_about(self):
        shown = Vigilance(self.results, enabled=False).open("c1")
        hidden = [p for p in shown["plants"] if p["hidden"]]
        self.assertEqual({p["id"] for p in hidden}, {"p01", "p02"})
        self.assertTrue(all(p["description"] == "" and p["patch"] == [] for p in hidden))
        self.assertNotIn("d-p01", json.dumps(shown))
        self.assertNotIn("d-p02", json.dumps(shown))

    def test_proof_that_is_only_a_test_is_flagged(self):
        data = run("big", "2026-11-14T05:00:00Z", self.plants, set())
        data["original_review"]["points"][0]["evidence"] = [{"file": "tests/ATests.cs", "line_start": 3, "line_end": 4}]
        (self.results / "big.json").write_text(json.dumps(data))
        big = [r for r in build_exam(self.results, "c1")["reviewers"] if r["name"] == "big"][0]
        self.assertTrue(big["points"][0]["tests_only"])

    def test_asking_for_a_full_read_without_finding_the_spot_is_not_a_catch(self):
        vigilance = Vigilance(self.results)
        result = vigilance.sign(vigilance.open("c1")["session"], "big", "Grace", "full_read")
        self.assertEqual((result["caught"], result["refused"]), (False, True))
        self.assertEqual(vigilance.record()["caught"], 0)

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

    def test_only_a_share_of_pull_requests_is_spot_checked_and_the_choice_sticks(self):
        draws = iter([0.9, 0.1, 0.0])
        vigilance = Vigilance(self.results, rate=0.5, rng=lambda: next(draws))
        self.assertEqual(self.shown(vigilance.open("c1")), ["if (value > max)"])   # 0.9: not picked
        self.assertEqual(self.shown(vigilance.open("c1")), ["if (value > max)"])   # and it stays that way
        vigilance.reset()
        self.assertEqual(self.shown(vigilance.open("c1")), ["if (value < max)"])   # 0.1: picked
        self.assertEqual(vigilance.record()["rate"], 0.5)

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
