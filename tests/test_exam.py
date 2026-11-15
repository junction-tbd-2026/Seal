import json
import tempfile
import unittest
from pathlib import Path

from reviewer_controls.exam import (
    build_exam,
    list_changes,
    list_pulls,
    make_signoff,
    requirement_title,
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
        self.assertIsNone(listed[0]["signed"])   # each browser marks its own sign-offs
        self.assertEqual(list_pulls(self.results / "missing.json", self.results)["pull_requests"], [])

    def test_signoffs_are_validated_and_nothing_is_written(self):
        with self.assertRaises(ValueError):
            make_signoff("c", "r", "   ", "accept")
        with self.assertRaises(ValueError):
            make_signoff("c", "r", "Ada", "maybe")
        before = sorted(path.name for path in self.results.iterdir())
        entry = make_signoff("c", "r", " Ada ", "full_read", [{"plant_id": "p1", "verdict": "wrong"}, {"plant_id": "p2"}])
        self.assertEqual((entry["change_id"], entry["name"], entry["decision"]), ("c", "Ada", "full_read"))
        self.assertEqual(entry["spots"], [{"plant_id": "p1", "verdict": "wrong"}])
        self.assertEqual(sorted(path.name for path in self.results.iterdir()), before)


if __name__ == "__main__":
    unittest.main()
