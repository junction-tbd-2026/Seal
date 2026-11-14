import json
import tempfile
import unittest
from pathlib import Path

from reviewer_controls.exam import (
    build_exam,
    list_changes,
    list_pulls,
    record_signoff,
    requirement_title,
    signoffs_for,
    structured_diff,
)

DIFF = (
    "diff --git a/src/A.cs b/src/A.cs\n--- a/src/A.cs\n+++ b/src/A.cs\n"
    "@@ -10,3 +10,3 @@\n keep\n-old\n+new\n keep2\n@@ -40,1 +40,2 @@\n tail\n+extra\n"
)


def plant(plant_id, kind, line):
    return {"id": plant_id, "kind": kind, "difficulty": "medium", "description": "d-" + plant_id,
            "file": "src/A.cs", "line_start": line, "line_end": line, "patch": DIFF}


def run(reviewer, created_at, plants, flagged_ids, failed_ids=(), inconclusive_ids=()):
    reviews, outcomes = [], []
    for p in plants:
        failed = p["id"] in failed_ids
        hit = p["id"] in flagged_ids
        reviews.append({
            "reviewer": reviewer, "variant_id": p["id"], "error": "boom" if failed else "",
            "findings": [{"file": "src/A.cs", "line_start": p["line_start"], "line_end": p["line_end"],
                          "message": "spotted " + p["id"], "severity": "major"}] if hit else [],
        })
        if not failed:
            outcomes.append({"plant_id": p["id"], "kind": p["kind"], "reviewer": reviewer, "flagged": hit,
                             "correct": hit == (p["kind"] != "harmless"), "inconclusive": p["id"] in inconclusive_ids})
    return {
        "change": {"id": "ju26-issue-1", "requirement_id": "1", "base_ref": "b", "head_ref": "h", "diff": DIFF,
                   "requirement_text": "# Requirement #1: Clamp must hold\n\nBody.\n"},
        "reviewer": reviewer, "planter": "planter-model", "created_at": created_at, "plants": plants,
        "original_review": {"meets_requirement": True, "findings": [], "refused_to_decide": ["q"], "error": ""},
        "variant_reviews": reviews, "outcomes": outcomes, "requirement_flip_changed_verdict": True,
        "altered_requirement_review": {"meets_requirement": False}, "prompt_tokens": 10, "completion_tokens": 5,
        "wall_seconds": 2.0, "notes": [], "build_checked": False,
    }


class ExamTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.results = Path(self.folder.name)
        self.plants = [plant("p01", "bug", 11), plant("p02", "omission", 41), plant("p03", "harmless", 11),
                       plant("p04", "bug", 41)]

    def save(self, name, data):
        (self.results / name).write_text(json.dumps(data))

    def test_structured_diff_rows(self):
        files = structured_diff(DIFF)
        self.assertEqual((files[0]["path"], files[0]["status"], files[0]["added"], files[0]["removed"]),
                         ("src/A.cs", "modified", 2, 1))
        self.assertEqual([(r["n"], r["kind"]) for r in files[0]["rows"]],
                         [(10, "ctx"), (None, "del"), (11, "add"), (12, "ctx"), (None, "gap"), (40, "ctx"), (41, "add")])

    def test_requirement_title(self):
        self.assertEqual(requirement_title("# Requirement #7: Do the thing\n\nx", "f"), "Do the thing")
        self.assertEqual(requirement_title("", "fallback"), "fallback")

    def test_results_per_reviewer_on_the_same_variants(self):
        self.save("a.json", run("big", "2026-11-14T03:00:00Z", self.plants, {"p01", "p03"}, failed_ids={"p04"}))
        self.save("b.json", run("small", "2026-11-14T03:05:00Z", self.plants, {"p01", "p02"}, inconclusive_ids={"p04"}))
        self.save("x__plants__y.json", {"plants": []})          # a plants file is not a run
        (self.results / "broken.json").write_text("{not json")  # unreadable files are skipped

        exam = build_exam(self.results, "ju26-issue-1")
        self.assertEqual(exam["change"]["requirement_title"], "Clamp must hold")
        self.assertEqual([r["name"] for r in exam["reviewers"]], ["big", "small"])
        big, small = exam["reviewers"]
        self.assertEqual(big["results"], {"p01": "caught", "p02": "missed", "p03": "false_alarm", "p04": "failed"})
        self.assertEqual(big["counts"], {"defects_total": 2, "defects_caught": 1, "harmless_total": 1,
                                         "false_alarms": 1, "failed": 1, "inconclusive": 0})
        self.assertEqual(big["read_yourself"], ["p02"])
        self.assertEqual(big["said"], {"p01": "spotted p01", "p03": "spotted p03"})
        self.assertIn("1 of 2 caught", big["claim"])
        self.assertEqual(small["results"], {"p01": "caught", "p02": "caught", "p03": "left_alone", "p04": "inconclusive"})
        self.assertIn("All 2 caught", small["claim"])
        self.assertEqual(exam["plants"][0]["patch"][0]["path"], "src/A.cs")

    def test_an_older_run_on_different_variants_is_left_out(self):
        self.save("old.json", run("big", "2026-11-14T01:00:00Z", self.plants[:2], {"p01"}))
        self.save("new.json", run("small", "2026-11-14T03:00:00Z", self.plants, {"p01"}))
        exam = build_exam(self.results, "ju26-issue-1")
        self.assertEqual([r["name"] for r in exam["reviewers"]], ["small"])
        self.assertEqual(len(exam["plants"]), 4)

    def test_the_newest_run_per_reviewer_wins(self):
        self.save("first.json", run("big", "2026-11-14T03:00:00Z", self.plants, set()))
        self.save("second.json", run("big", "2026-11-14T04:00:00Z", self.plants, {"p01", "p02", "p04"}))
        exam = build_exam(self.results, "ju26-issue-1")
        self.assertEqual(len(exam["reviewers"]), 1)
        self.assertEqual(exam["reviewers"][0]["counts"]["defects_caught"], 3)

    def test_unknown_change_and_listing(self):
        self.assertIsNone(build_exam(self.results, "nope"))
        self.save("a.json", run("big", "2026-11-14T03:00:00Z", self.plants, set()))
        self.save("b.json", run("small", "2026-11-14T03:05:00Z", self.plants, set()))
        listed = list_changes(self.results)
        self.assertEqual(len(listed), 1)
        self.assertEqual((listed[0]["id"], listed[0]["title"], sorted(listed[0]["reviewers"])),
                         ("ju26-issue-1", "Clamp must hold", ["big", "small"]))

    def test_pull_requests_show_where_sign_off_stands(self):
        pulls_file = self.results / "pulls.json"
        pulls_file.write_text(json.dumps({
            "repository": "me/repo", "repository_url": "https://example.invalid/me/repo",
            "pull_requests": [
                {"number": 1, "change_id": "ju26-issue-1", "requirement_id": "1", "title": "t1"},
                {"number": 2, "change_id": "never-run", "requirement_id": "2", "title": "t2"},
            ],
        }))
        self.save("a.json", run("big", "2026-11-14T03:00:00Z", self.plants, {"p01"}))
        listed = list_pulls(pulls_file, self.results)["pull_requests"]
        # p02 and p04 were both missed on line 41: that is one place to read, not two.
        self.assertEqual([(p["number"], p["status"], p["lines_to_read"]) for p in listed],
                         [(1, "needs_you", 1), (2, "untested", 0)])
        self.assertEqual(listed[0]["url"], "https://example.invalid/me/repo/pull/1")
        record_signoff(self.results, "ju26-issue-1", "big", "Ada", "accept")
        again = list_pulls(pulls_file, self.results)["pull_requests"][0]
        self.assertEqual((again["status"], again["signed"]["name"]), ("signed", "Ada"))
        self.assertEqual(list_pulls(self.results / "missing.json", self.results)["pull_requests"], [])

    def test_signoffs_are_appended_and_validated(self):
        with self.assertRaises(ValueError):
            record_signoff(self.results, "c", "r", "   ", "accept")
        with self.assertRaises(ValueError):
            record_signoff(self.results, "c", "r", "Ada", "maybe")
        record_signoff(self.results, "c", "r", " Ada ", "accept")
        record_signoff(self.results, "c", "r", "Grace", "full_read")
        record_signoff(self.results, "other", "r", "Linus", "reject")
        entries = signoffs_for(self.results, "c")
        self.assertEqual([(e["name"], e["decision"]) for e in entries], [("Ada", "accept"), ("Grace", "full_read")])


if __name__ == "__main__":
    unittest.main()


class ProvenAndJudgementTests(unittest.TestCase):
    """An objective is proven only by breaks it noticed and harmless edits it ignored, in the same lines."""

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.results = Path(self.folder.name)

    def paired_run(self, withdrew=(True, True), near_alarm=False, breaks=2):
        plants = [dict(plant("b{}".format(i), "bug", 11), breaks="R1") for i in range(breaks)]
        plants.append(dict(plant("h1", "harmless", 11), near="R1"))
        data = run("big", "2026-11-14T03:00:00Z", plants, set())
        data["requirement_points"] = [{"id": "R1", "text": "Above max gives max."}]
        data["original_review"]["points"] = [
            {"id": "R1", "status": "met", "claimed_status": "met", "reason": "",
             "evidence": [{"file": "src/A.cs", "line_start": 11, "line_end": 11}]}
        ]
        for outcome in data["outcomes"]:
            if outcome["plant_id"].startswith("b"):
                index = int(outcome["plant_id"][1:])
                outcome.update(point_link="confirmed", point_noticed=withdrew[index], correct=withdrew[index])
            else:
                outcome.update(near_point="R1", near_alarm=near_alarm, flagged=near_alarm, correct=not near_alarm)
        (self.results / "run.json").write_text(json.dumps(data))
        return build_exam(self.results, "ju26-issue-1")["reviewers"][0]["points"][0]

    def test_two_noticed_breaks_and_a_quiet_harmless_edit_prove_an_objective(self):
        self.assertTrue(self.paired_run()["proven"])

    def test_an_alarm_on_a_harmless_edit_in_the_same_lines_unproves_it(self):
        point = self.paired_run(near_alarm=True)
        self.assertFalse(point["proven"])
        self.assertEqual((point["harmless_near"], point["harmless_near_alarms"]), (1, 1))

    def test_one_break_is_not_enough_and_neither_is_flagging_while_still_saying_met(self):
        self.assertFalse(self.paired_run(withdrew=(True,), breaks=1)["proven"])
        self.assertFalse(self.paired_run(withdrew=(True, False))["proven"])

    def test_judgement_words(self):
        from reviewer_controls.exam import judgement
        self.assertEqual(judgement(6, 7, 0, 3), "sharp")
        self.assertEqual(judgement(5, 7, 2, 3), "jumpy")
        self.assertEqual(judgement(0, 7, 0, 3), "blind")
        self.assertEqual(judgement(3, 7, 2, 3), "mixed")
        self.assertEqual(judgement(1, 2, 0, 3), "untested")


class OwnerApprovalTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.results = Path(self.folder.name)
        self.proposed = [{"id": "R1", "text": "one"}, {"id": "R2", "text": "two"}]

    def test_an_approval_keeps_strikes_marks_risk_and_adds(self):
        from reviewer_controls.objectives import approved_points, latest_approval, record_approval
        record_approval(self.results, "c", self.proposed, "Pat",
                        [{"id": "R1", "decision": "keep", "risk": "high"}, {"id": "R2", "decision": "strike"}, {"id": "R9"}],
                        [{"text": "No new allocations on the hot path"}, {"text": "  "}])
        approval = latest_approval(self.results, "c")
        self.assertEqual([(o["id"], o["decision"], o["risk"]) for o in approval["objectives"]],
                         [("R1", "keep", "high"), ("R2", "strike", "normal"), ("R3", "keep", "normal")])
        points, risky = approved_points(approval)
        self.assertEqual(([p.id for p in points], risky), (["R1", "R3"], ["R1"]))

    def test_an_approval_needs_a_name_and_something_kept(self):
        from reviewer_controls.objectives import record_approval
        with self.assertRaises(ValueError):
            record_approval(self.results, "c", self.proposed, " ", [])
        with self.assertRaises(ValueError):
            record_approval(self.results, "c", self.proposed, "Pat", [{"id": "R1", "decision": "strike"}, {"id": "R2", "decision": "strike"}])

    def test_the_newest_approval_counts_and_older_ones_stay_on_record(self):
        from reviewer_controls.objectives import APPROVAL_FILE, latest_approval, record_approval
        record_approval(self.results, "c", self.proposed, "Pat", [])
        record_approval(self.results, "c", self.proposed, "Sam", [{"id": "R2", "decision": "strike"}])
        self.assertEqual(latest_approval(self.results, "c")["name"], "Sam")
        self.assertEqual(len((self.results / APPROVAL_FILE).read_text().splitlines()), 2)


class RuleAndLedgerTests(unittest.TestCase):
    def test_a_very_large_change_goes_to_a_full_read_by_rule_and_the_ledger_counts_answers(self):
        from reviewer_controls.ledger import build_ledger
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        results = Path(folder.name)
        (results / "run.json").write_text(json.dumps(run("big", "2026-11-14T03:00:00Z", [plant("p01", "bug", 11)], set())))
        pulls = results / "pulls.json"
        pulls.write_text(json.dumps({"repository_url": "https://example.invalid/r", "pull_requests": [
            {"number": 1, "change_id": "ju26-issue-1", "title": "small", "files": 4},
            {"number": 4, "change_id": "ju26-issue-4", "title": "huge", "files": 237},
        ]}))
        record_signoff(results, "ju26-issue-1", "big", "Ada", "reject", findings={"0": "real", "1": "not_real"}, seconds=42)
        ledger = build_ledger(results, pulls, None, {"caught": 1, "checked": 2})
        self.assertEqual([c["status"] for c in ledger["changes"]][1], "full_read_rule")
        self.assertEqual(ledger["measures"]["findings_real"], {"real": 1, "judged": 2})
        self.assertEqual(ledger["measures"]["time_to_sign"]["median_seconds"], 42)
        self.assertEqual(ledger["measures"]["signer_drill"], {"caught": 1, "checked": 2})
