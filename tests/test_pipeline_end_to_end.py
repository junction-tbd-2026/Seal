"""Runs the whole flow on a tiny real git repository, with a scripted stand-in for the models.

The stand-in exists so these tests need no keys, cost nothing and run in under a second.
The real run uses the same code with real model clients.
"""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from reviewer_controls.card import render_card
from reviewer_controls.changes import ChangeLoadError, load_change
from reviewer_controls.controls import run_controls, summarise
from reviewer_controls.diffs import render_numbered, split_diff
from reviewer_controls.llm import ChatResponse, ModelError, extract_json
from reviewer_controls.models import KIND_BUG, KIND_HARMLESS
from reviewer_controls.planter import ALTER_SYSTEM, PLANT_SYSTEM, ModelPlanter, allocate, candidate_files, locate
from reviewer_controls.reviewer import REVIEW_SYSTEM, ModelReviewer, fit_diff

BASE = """public class Calc
{
    public int Clamp(int value, int max)
    {
        return value;
    }
}
"""

HEAD = """public class Calc
{
    public int Clamp(int value, int max)
    {
        if (value > max)
        {
            return max;
        }
        return value;
    }
}
"""

PROPOSALS = {
    "edits": [
        {"kind": "bug", "difficulty": "easy", "description": "comparison inverted",
         "line_start": 5, "line_end": 5, "original": "if (value > max)", "replacement": "        if (value < max)"},
        # Line numbers deliberately wrong: the quoted text must rescue it.
        {"kind": "bug", "difficulty": "hard", "description": "clamps one below the maximum",
         "line_start": 70, "line_end": 70, "original": "return max;", "replacement": "            return max - 1;"},
        {"kind": "harmless", "difficulty": "easy", "description": "redundant parentheses",
         "line_start": 9, "line_end": 9, "original": "return value;", "replacement": "        return (value);"},
        {"kind": "bug", "difficulty": "easy", "description": "quotes text that is not in the file",
         "line_start": 6, "line_end": 6, "original": "while (true)", "replacement": "for (;;)"},
        {"kind": "bug", "difficulty": "easy", "description": "outside the changed lines",
         "line_start": 1, "line_end": 1, "original": "public class Calc", "replacement": "public class Calc2"},
    ]
}


class ScriptedModel:
    """Answers like a model would, from a script. Catches the easy bug and misses the hard one."""

    model = "scripted"

    def __init__(self):
        self.calls = []

    def complete(self, system, user, temperature=0.0, max_tokens=4000):
        self.calls.append((system, user))
        if system == PLANT_SYSTEM:
            return ChatResponse("Here you go:\n```json\n{}\n```".format(json.dumps(PROPOSALS)), 100, 50, 0.1)
        if system == ALTER_SYSTEM:
            return ChatResponse("ALTERED: values above max must raise an error instead of being clamped.", 10, 10, 0.1)
        if system == REVIEW_SYSTEM:
            reply = {"meets_requirement": True, "findings": [], "refused_to_decide": ["Whether max can be negative."]}
            if "ALTERED" in user:
                reply["meets_requirement"] = False
            if "value < max" in user:
                reply["findings"] = [{"file": "src/Calc.cs", "line_start": 5, "line_end": 5,
                                      "severity": "critical", "message": "comparison is inverted"}]
            return ChatResponse(json.dumps(reply), 200, 40, 0.1)
        raise AssertionError("unexpected prompt")


def make_repo(folder: Path) -> Path:
    repo = folder / "sample"
    (repo / "src").mkdir(parents=True)

    def git(*args):
        subprocess.run(
            ["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@example.invalid",
             "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"] + list(args),
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )

    git("init", "-q", "-b", "main")
    (repo / "src" / "Calc.cs").write_text(BASE)
    git("add", "-A")
    git("commit", "-q", "-m", "base")
    git("switch", "-q", "-c", "ju26-issue-1")
    (repo / "src" / "Calc.cs").write_text(HEAD)
    (repo / "README.md").write_text("docs\n")
    git("add", "-A")
    git("commit", "-q", "-m", "change")
    return repo


class EndToEndTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        root = Path(self.folder.name)
        self.repo = make_repo(root)
        self.requirements = root / "requirements"
        self.requirements.mkdir()
        (self.requirements / "1.md").write_text("# Requirement #1\n\nClamp must never return more than max.\n")
        self.change = load_change(self.repo, "ju26-issue-1", self.requirements)

    def run_all(self, count=3, kinds=(KIND_BUG, KIND_HARMLESS)):
        model = ScriptedModel()
        report = run_controls(
            self.change, ModelPlanter(model, self.repo, name="planter-model"),
            ModelReviewer(model, name="reviewer-model"), count=count, kinds=kinds, workers=2,
        )
        return report, model

    def test_change_is_loaded_from_git(self):
        self.assertEqual(self.change.requirement_id, "1")
        files = split_diff(self.change.diff)
        self.assertEqual(sorted(f.path for f in files), ["README.md", "src/Calc.cs"])
        calc = [f for f in files if f.path == "src/Calc.cs"][0]
        self.assertEqual(calc.added_ranges, [(5, 8)])
        self.assertEqual([f.path for f in candidate_files(self.change)], ["src/Calc.cs"])

    def test_unknown_change_and_missing_requirement_fail_clearly(self):
        with self.assertRaises(ChangeLoadError):
            load_change(self.repo, "no-such-branch-issue-1", self.requirements)
        with self.assertRaises(ChangeLoadError):
            load_change(self.repo, "ju26-issue-1", self.requirements, requirement_id="999")

    def test_only_usable_proposals_become_plants(self):
        report, _ = self.run_all()
        self.assertEqual([(p.id, p.kind, p.line_start, p.line_end) for p in report.plants],
                         [("p01", "bug", 5, 5), ("p02", "bug", 7, 7), ("p03", "harmless", 9, 9)])
        self.assertIn("-        if (value > max)", report.plants[0].patch)
        self.assertIn("+        if (value < max)", report.plants[0].patch)

    def test_each_variant_is_a_whole_change_and_never_shows_the_original_line(self):
        report, _ = self.run_all()
        variant = report.plants[0].variant_diff
        self.assertIn("+        if (value < max)", variant)
        self.assertNotIn("value > max", variant)
        self.assertIn("README.md", variant)

    def test_reviewer_is_never_told_about_the_test(self):
        _, model = self.run_all()
        for system, user in model.calls:
            if system == REVIEW_SYSTEM:
                for word in ("planted", "deliberate", "variant", "inverted"):
                    self.assertNotIn(word, user.lower())

    def test_scores(self):
        report, _ = self.run_all()
        by_plant = {o.plant_id: o for o in report.outcomes}
        self.assertTrue(by_plant["p01"].correct)            # easy bug caught
        self.assertFalse(by_plant["p02"].correct)           # hard bug missed
        self.assertTrue(by_plant["p03"].correct)            # harmless edit left alone
        self.assertEqual(summarise(report), {
            "planted": 3, "defects_total": 2, "defects_caught": 1, "harmless_total": 1,
            "false_alarms": 0, "inconclusive": 0, "failed_reviews": 0,
        })

    def test_altered_requirement_changes_the_verdict(self):
        report, _ = self.run_all()
        self.assertTrue(report.altered_requirement.startswith("ALTERED"))
        self.assertTrue(report.requirement_flip_changed_verdict)

    def test_card_and_saved_report(self):
        report, _ = self.run_all()
        card = render_card(report)
        self.assertIn("1 of 2 caught", card)
        self.assertIn("`src/Calc.cs` around lines 7-7 (bug, hard): clamps one below the maximum", card)
        self.assertNotIn("comparison inverted", card.split("## Read these lines yourself")[1].split("##")[0])
        self.assertIn("Whether max can be negative.", card)
        self.assertIn("were not compiled", card)
        saved = json.loads(json.dumps(report.to_dict()))
        self.assertNotIn("variant_diff", saved["plants"][0])
        self.assertEqual(saved["reviewer"], "reviewer-model")

    def test_two_different_edits_on_one_line_are_both_kept_but_duplicates_are_not(self):
        class SameLine(ScriptedModel):
            def complete(self, system, user, temperature=0.0, max_tokens=4000):
                if system != PLANT_SYSTEM:
                    return ScriptedModel.complete(self, system, user, temperature, max_tokens)
                edit = lambda text: {"kind": "bug", "description": text, "line_start": 5, "line_end": 5,
                                     "original": "if (value > max)", "replacement": "        " + text}
                edits = [edit("if (value < max)"), edit("if (value < max)"), edit("if (value > max + 1)")]
                return ChatResponse(json.dumps({"edits": edits}), 1, 1, 0.1)

        plants = ModelPlanter(SameLine(), self.repo, name="p").plant(self.change, 3)
        self.assertEqual([(p.line_start, p.description) for p in plants],
                         [(5, "if (value < max)"), (5, "if (value > max + 1)")])

    def test_a_second_reviewer_sits_the_same_exam(self):
        model = ScriptedModel()
        planter = ModelPlanter(model, self.repo, name="planter-model")
        first = run_controls(self.change, planter, ModelReviewer(model, name="one"),
                             count=3, kinds=(KIND_BUG, KIND_HARMLESS))
        second = run_controls(self.change, planter, ModelReviewer(model, name="two"),
                              count=3, kinds=(KIND_BUG, KIND_HARMLESS),
                              plants=first.plants, altered_requirement=first.altered_requirement)
        self.assertIs(second.plants, first.plants)
        self.assertEqual(second.altered_requirement, first.altered_requirement)
        self.assertEqual(sum(1 for system, _ in model.calls if system == PLANT_SYSTEM), 1)
        self.assertEqual(sum(1 for system, _ in model.calls if system == ALTER_SYSTEM), 1)
        self.assertEqual(summarise(second), summarise(first))
        self.assertEqual(second.reviewer, "two")

    def test_reviewer_diff_budget_is_respected(self):
        model = ScriptedModel()
        ModelReviewer(model, name="small", max_diff_chars=200).review(self.change)
        self.assertIn("Not shown", model.calls[-1][1])

    def test_same_model_for_both_roles_is_noted(self):
        model = ScriptedModel()
        report = run_controls(self.change, ModelPlanter(model, self.repo), ModelReviewer(model), count=1)
        self.assertTrue(any("same model" in note for note in report.notes))

    def test_a_failed_review_is_left_out_of_the_score(self):
        class Flaky(ScriptedModel):
            def complete(self, system, user, temperature=0.0, max_tokens=4000):
                if system == REVIEW_SYSTEM and "max - 1" in user:
                    raise ModelError("HTTP 429 from https://example.invalid")
                return ScriptedModel.complete(self, system, user, temperature, max_tokens)

        report = run_controls(self.change, ModelPlanter(ScriptedModel(), self.repo, name="p"),
                              ModelReviewer(Flaky(), name="r"), count=3, kinds=(KIND_BUG, KIND_HARMLESS))
        counts = summarise(report)
        self.assertEqual((counts["defects_total"], counts["failed_reviews"]), (1, 1))
        self.assertTrue(any("p02 failed" in note for note in report.notes))


class SmallPieceTests(unittest.TestCase):
    def test_extract_json_ignores_prose_and_fences(self):
        self.assertEqual(extract_json('Sure.\n```json\n{"a": [1, 2]}\n```\nDone.'), {"a": [1, 2]})
        with self.assertRaises(ModelError):
            extract_json("no json here")

    def test_locate_trusts_the_quoted_text_over_the_numbers(self):
        lines = ["a", "  b", "c"]
        self.assertEqual(locate(lines, 2, 2, "b"), (2, 2))
        self.assertEqual(locate(lines, 9, 9, "b"), (2, 2))
        self.assertIsNone(locate(lines, 2, 2, "zzz"))
        self.assertIsNone(locate(["x", "x"], 9, 9, "x"))     # ambiguous: refuse to guess

    def test_allocate_follows_added_line_counts(self):
        files = split_diff(
            "diff --git a/A.cs b/A.cs\n--- a/A.cs\n+++ b/A.cs\n@@ -1,0 +1,9 @@\n" + "+x\n" * 9
            + "diff --git a/B.cs b/B.cs\n--- a/B.cs\n+++ b/B.cs\n@@ -1,0 +1,1 @@\n+y\n"
        )
        self.assertEqual(allocate(files, 5), [5, 0])
        self.assertEqual(sum(allocate(files, 12)), 12)

    def test_numbered_view_uses_new_file_line_numbers(self):
        diff = "diff --git a/A.cs b/A.cs\n--- a/A.cs\n+++ b/A.cs\n@@ -10,3 +10,3 @@\n keep\n-old\n+new\n keep2\n"
        shown = render_numbered(diff)
        self.assertIn("   10   keep", shown)
        self.assertIn("      - old", shown)
        self.assertIn("   11 + new", shown)
        self.assertIn("   12   keep2", shown)

    def test_oversized_diff_drops_whole_files_and_says_so(self):
        big = "".join(
            "diff --git a/F{0}.cs b/F{0}.cs\n--- a/F{0}.cs\n+++ b/F{0}.cs\n@@ -1,0 +1,50 @@\n".format(i) + "+line\n" * 50
            for i in range(5)
        )
        shown = fit_diff(big, limit=1500)
        self.assertIn("=== File: F0.cs", shown)
        self.assertIn("Not shown", shown)
        self.assertIn("F4.cs", shown)


SAMPLE_REPO = Path(__file__).resolve().parents[1] / "work" / "junction26-messagepack-csharp"


@unittest.skipUnless((SAMPLE_REPO / ".git").exists(), "sample repository not cloned")
class SampleRepositoryTests(unittest.TestCase):
    def test_smallest_sample_change_loads(self):
        requirements = Path(__file__).resolve().parents[1] / "requirements"
        change = load_change(SAMPLE_REPO, "ju26-issue-2283", requirements)
        self.assertEqual(change.requirement_id, "2283")
        self.assertEqual(len(split_diff(change.diff)), 4)
        candidates = candidate_files(change)
        self.assertEqual([f.path for f in candidates],
                         ["src/MessagePack.SourceGenerator/CodeAnalysis/TypeCollector.cs"])
        self.assertIn((239, 239), candidates[0].added_ranges)


if __name__ == "__main__":
    unittest.main()
