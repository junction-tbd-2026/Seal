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
from reviewer_controls.controls import cited_targets, run_controls, summarise
from reviewer_controls.diffs import render_numbered, split_diff
from reviewer_controls.llm import ChatResponse, ModelError, extract_json
from reviewer_controls.models import KIND_BUG, KIND_HARMLESS
from reviewer_controls.pipeline import load_plants, save_plants
from reviewer_controls.planter import (
    ALTER_SYSTEM, PLANT_SYSTEM, POINTS_SYSTEM, ModelPlanter, allocate, apply_edit, candidate_files, changes_code, locate,
    merge_similar,
)
from reviewer_controls.models import RequirementPoint
from reviewer_controls.reviewer import REVIEW_SYSTEM, ModelReviewer, check_evidence, fit_diff, parse_points

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
        {"kind": "bug", "difficulty": "easy", "description": "comparison inverted", "breaks": "R1",
         "line_start": 5, "line_end": 5, "original": "if (value > max)", "replacement": "        if (value < max)"},
        # Line numbers deliberately wrong: the quoted text must rescue it.
        {"kind": "bug", "difficulty": "hard", "description": "clamps one below the maximum", "breaks": "R1",
         "line_start": 70, "line_end": 70, "original": "return max;", "replacement": "            return max - 1;"},
        {"kind": "harmless", "difficulty": "easy", "description": "redundant parentheses", "breaks": "R2",
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
        if system == POINTS_SYSTEM:
            points = [{"id": "x", "text": "Values above max come back as max."},
                      {"id": "y", "text": "Values at or below max come back unchanged."}]
            return ChatResponse(json.dumps({"points": points}), 20, 20, 0.1)
        if system == PLANT_SYSTEM:
            return ChatResponse("Here you go:\n```json\n{}\n```".format(json.dumps(PROPOSALS)), 100, 50, 0.1)
        if system == ALTER_SYSTEM:
            return ChatResponse("ALTERED: values above max must raise an error instead of being clamped.", 10, 10, 0.1)
        if system == REVIEW_SYSTEM:
            reply = {"meets_requirement": True, "findings": [], "refused_to_decide": ["Whether max can be negative."]}
            if "Requirement points:" in user:
                reply["points"] = [
                    {"id": "R1", "status": "not_met" if "value < max" in user else "met",
                     "evidence": [{"file": "src/Calc.cs", "line_start": 5, "line_end": 8}], "reason": "the clamp"},
                    {"id": "R2", "status": "met",
                     "evidence": [{"file": "src/Calc.cs", "line_start": 9, "line_end": 9}], "reason": "falls through"},
                ]
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

    def test_requirement_is_split_into_points_and_each_gets_evidence(self):
        report, model = self.run_all()
        self.assertEqual([(p.id, p.text) for p in report.requirement_points],
                         [("R1", "Values above max come back as max."), ("R2", "Values at or below max come back unchanged.")])
        self.assertEqual([p.breaks for p in report.plants], ["R1", "R1", None])   # a harmless edit breaks nothing
        original = report.original_review.points
        self.assertEqual([(p.id, p.status, p.evidence[0]["line_start"]) for p in original], [("R1", "met", 5), ("R2", "met", 9)])
        plant_prompt = [user for system, user in model.calls if system == PLANT_SYSTEM][0]
        self.assertIn("R1: Values above max come back as max.", plant_prompt)
        by_plant = {o.plant_id: o for o in report.outcomes}
        self.assertEqual((by_plant["p01"].point_id, by_plant["p01"].point_noticed), ("R1", True))
        self.assertEqual((by_plant["p02"].point_id, by_plant["p02"].point_noticed), ("R1", False))
        self.assertEqual((by_plant["p03"].point_id, by_plant["p03"].point_noticed), (None, None))

    def test_the_real_change_is_reviewed_before_anything_is_planted(self):
        _, model = self.run_all()
        order = [system for system, _ in model.calls]
        self.assertLess(order.index(REVIEW_SYSTEM), order.index(PLANT_SYSTEM))
        plant_prompt = [user for system, user in model.calls if system == PLANT_SYSTEM][0]
        self.assertIn("Lines a reviewer cited as evidence", plant_prompt)
        self.assertIn("R1: 5-8", plant_prompt)

    def test_a_break_outside_the_cited_lines_is_not_used(self):
        targets = {"R2": [{"file": "src/Calc.cs", "line_start": 9, "line_end": 9}]}     # only line 9 was cited
        points = [RequirementPoint("R1", "a"), RequirementPoint("R2", "b")]
        planter = ModelPlanter(ScriptedModel(), self.repo, name="p")
        plants = planter.plant(self.change, 3, (KIND_BUG, KIND_HARMLESS), points, targets)
        self.assertEqual([(p.kind, p.line_start) for p in plants], [("harmless", 9)])    # both bugs sat at lines 5 and 7
        self.assertTrue(any("outside the changed or cited lines" in problem for problem in planter.problems))

    def test_a_break_is_credited_to_the_point_whose_cited_lines_it_sits_in(self):
        targets = {"R2": [{"file": "src/Calc.cs", "line_start": 5, "line_end": 8}]}
        points = [RequirementPoint("R1", "a"), RequirementPoint("R2", "b")]
        plants = ModelPlanter(ScriptedModel(), self.repo, name="p").plant(self.change, 3, (KIND_BUG, KIND_HARMLESS), points, targets)
        self.assertEqual([p.breaks for p in plants], ["R2", "R2", None])     # the planter said R1; the lines say R2

    def test_cited_targets_collects_only_points_called_met(self):
        report, _ = self.run_all()
        report.original_review.points[1].status = "cannot_tell"
        self.assertEqual(cited_targets([report.original_review, report.original_review]),
                         {"R1": [{"file": "src/Calc.cs", "line_start": 5, "line_end": 8, "in_change": True}]})

    def test_checklist_is_written_without_sight_of_the_code(self):
        _, model = self.run_all()
        prompt = [user for system, user in model.calls if system == POINTS_SYSTEM][0]
        self.assertIn("Clamp must never return more than max.", prompt)
        self.assertNotIn("value > max", prompt)
        self.assertNotIn("diff --git", prompt)

    def test_planted_edits_inside_the_cited_lines_are_confirmed(self):
        report, _ = self.run_all()
        links = {o.plant_id: o.point_link for o in report.outcomes}
        self.assertEqual(links, {"p01": "confirmed", "p02": "confirmed", "p03": None})

    def test_a_citation_outside_the_change_is_dropped_and_the_point_is_no_longer_met(self):
        class CitesNonsense(ScriptedModel):
            def complete(self, system, user, temperature=0.0, max_tokens=4000):
                response = ScriptedModel.complete(self, system, user, temperature, max_tokens)
                if system == REVIEW_SYSTEM and "Requirement points:" in user:
                    reply = json.loads(response.text)
                    reply["points"][0]["evidence"] = [{"file": "src/Calc.cs", "line_start": 400, "line_end": 410}]
                    reply["points"][1]["evidence"] = [{"file": "src/Other.cs", "line_start": 9, "line_end": 9}]
                    return ChatResponse(json.dumps(reply), 1, 1, 0.1)
                return response

        review = ModelReviewer(CitesNonsense(), name="r").review(
            self.change, points=[RequirementPoint("R1", "a"), RequirementPoint("R2", "b")]
        )
        self.assertEqual([(p.status, p.evidence, p.dropped_evidence) for p in review.points],
                         [("cannot_tell", [], 1), ("cannot_tell", [], 1)])
        self.assertIn("not part of this change", review.points[0].reason)

    def test_valid_citations_are_kept_and_marked_as_touching_the_change(self):
        report, _ = self.run_all()
        first, second = report.original_review.points
        self.assertEqual((first.evidence[0]["file"], first.evidence[0]["in_change"]), ("src/Calc.cs", True))
        self.assertFalse(second.evidence[0]["in_change"])    # line 9 is shown but unchanged

    def test_an_answer_that_changes_with_nothing_changed_is_not_scored(self):
        class Unsteady(ScriptedModel):
            def __init__(self):
                ScriptedModel.__init__(self)
                self.reviews = 0

            def complete(self, system, user, temperature=0.0, max_tokens=4000):
                response = ScriptedModel.complete(self, system, user, temperature, max_tokens)
                if system == REVIEW_SYSTEM and "Requirement points:" in user:
                    self.reviews += 1
                    if self.reviews == 2:          # the repeat review of the unchanged change
                        reply = json.loads(response.text)
                        reply["points"][0]["status"] = "cannot_tell"
                        return ChatResponse(json.dumps(reply), 1, 1, 0.1)
                return response

        report = run_controls(self.change, ModelPlanter(ScriptedModel(), self.repo, name="p"),
                              ModelReviewer(Unsteady(), name="r"), count=3, kinds=(KIND_BUG, KIND_HARMLESS), workers=1)
        self.assertEqual(report.unstable_points, ["R1"])
        self.assertTrue(all(o.point_noticed is None for o in report.outcomes))
        self.assertTrue(any("two identical reviews" in note for note in report.notes))

    def test_withdrawing_a_met_on_a_harmless_edit_is_a_false_alarm(self):
        class Jumpy(ScriptedModel):
            def complete(self, system, user, temperature=0.0, max_tokens=4000):
                response = ScriptedModel.complete(self, system, user, temperature, max_tokens)
                if system == REVIEW_SYSTEM and "return (value);" in user:
                    reply = json.loads(response.text)
                    reply["points"][1]["status"] = "not_met"
                    return ChatResponse(json.dumps(reply), 1, 1, 0.1)
                return response

        report = run_controls(self.change, ModelPlanter(ScriptedModel(), self.repo, name="p"),
                              ModelReviewer(Jumpy(), name="r"), count=3, kinds=(KIND_BUG, KIND_HARMLESS))
        outcome = {o.plant_id: o for o in report.outcomes}["p03"]
        self.assertEqual((outcome.flagged, outcome.correct), (True, False))
        self.assertEqual(summarise(report)["false_alarms"], 1)

    def test_noticing_a_broken_point_counts_as_catching_it_even_without_a_line(self):
        class NoticesByPoint(ScriptedModel):
            def complete(self, system, user, temperature=0.0, max_tokens=4000):
                response = ScriptedModel.complete(self, system, user, temperature, max_tokens)
                if system == REVIEW_SYSTEM and "max - 1" in user:
                    reply = json.loads(response.text)
                    reply["points"][0]["status"] = "cannot_tell"
                    return ChatResponse(json.dumps(reply), 1, 1, 0.1)
                return response

        report = run_controls(self.change, ModelPlanter(ScriptedModel(), self.repo, name="p"),
                              ModelReviewer(NoticesByPoint(), name="r"), count=3, kinds=(KIND_BUG, KIND_HARMLESS))
        outcome = {o.plant_id: o for o in report.outcomes}["p02"]
        self.assertEqual((outcome.flagged, outcome.point_noticed, outcome.correct), (False, True, True))
        self.assertEqual(summarise(report)["defects_caught"], 2)

    def test_altered_requirement_review_is_not_given_the_original_points(self):
        _, model = self.run_all()
        altered = [user for system, user in model.calls if system == REVIEW_SYSTEM and "ALTERED" in user]
        self.assertEqual(len(altered), 1)
        self.assertNotIn("Requirement points:", altered[0])

    def test_a_second_reviewer_sits_the_same_exam(self):
        model = ScriptedModel()
        planter = ModelPlanter(model, self.repo, name="planter-model")
        first = run_controls(self.change, planter, ModelReviewer(model, name="one"),
                             count=3, kinds=(KIND_BUG, KIND_HARMLESS))
        second = run_controls(self.change, planter, ModelReviewer(model, name="two"),
                              count=3, kinds=(KIND_BUG, KIND_HARMLESS),
                              plants=first.plants, altered_requirement=first.altered_requirement,
                              points=first.requirement_points)
        self.assertIs(second.plants, first.plants)
        self.assertEqual(second.requirement_points, first.requirement_points)
        self.assertEqual(sum(1 for system, _ in model.calls if system == POINTS_SYSTEM), 1)
        self.assertEqual(second.altered_requirement, first.altered_requirement)
        self.assertEqual(sum(1 for system, _ in model.calls if system == PLANT_SYSTEM), 1)
        self.assertEqual(sum(1 for system, _ in model.calls if system == ALTER_SYSTEM), 1)
        self.assertEqual(summarise(second), summarise(first))
        self.assertEqual(second.reviewer, "two")

    def test_planted_variants_survive_saving_and_loading(self):
        report, _ = self.run_all()
        path = Path(self.folder.name) / "plants.json"
        save_plants(path, self.change.id, report.planter, report.plants, report.altered_requirement,
                    report.requirement_points)
        plants, altered, points = load_plants(path, self.change.id)
        self.assertEqual(points, report.requirement_points)
        self.assertEqual([p.breaks for p in plants], ["R1", "R1", None])
        self.assertEqual([(p.id, p.kind, p.line_start, p.variant_diff) for p in plants],
                         [(p.id, p.kind, p.line_start, p.variant_diff) for p in report.plants])
        self.assertEqual(altered, report.altered_requirement)
        again = run_controls(self.change, ModelPlanter(ScriptedModel(), self.repo, name="p"),
                             ModelReviewer(ScriptedModel(), name="r"), plants=plants, altered_requirement=altered,
                             points=points)
        self.assertEqual(summarise(again), summarise(report))

    def test_planted_variants_of_another_change_are_refused(self):
        report, _ = self.run_all()
        path = Path(self.folder.name) / "plants.json"
        save_plants(path, "some-other-change", report.planter, report.plants, None)
        with self.assertRaises(ValueError):
            load_plants(path, self.change.id)

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


class PairedPlantingTests(unittest.TestCase):
    """Breaks and harmless edits in the same cited lines, so the reviewer is tested on telling them apart."""

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        root = Path(self.folder.name)
        self.repo = make_repo(root)
        requirements = root / "requirements"
        requirements.mkdir()
        (requirements / "1.md").write_text("# Requirement #1\n\nClamp must never return more than max.\n")
        self.change = load_change(self.repo, "ju26-issue-1", requirements)
        self.points = [RequirementPoint(id="R1", text="above max gives max"), RequirementPoint(id="R2", text="else unchanged")]
        self.targets = {
            "R1": [{"file": "src/Calc.cs", "line_start": 5, "line_end": 8}],
            "R2": [{"file": "src/Calc.cs", "line_start": 9, "line_end": 9}],
        }

    def plant(self, **kwargs):
        planter = ModelPlanter(ScriptedModel(), self.repo, name="planter-model")
        return planter, planter.plant_per_point(self.change, self.points, self.targets, **kwargs)

    def test_breaks_go_to_their_point_and_harmless_edits_are_tagged_with_the_point_they_sit_in(self):
        planter, plants = self.plant(per_point=2, silence=0)
        defects = [p for p in plants if p.kind != KIND_HARMLESS]
        harmless = [p for p in plants if p.kind == KIND_HARMLESS]
        self.assertEqual({p.breaks for p in defects}, {"R1"})
        self.assertEqual(len(defects), 2)
        self.assertEqual([(p.near, p.breaks) for p in harmless], [("R2", None)])
        self.assertTrue(any("harmless" in problem for problem in planter.problems))   # fewer than asked are said so

    def test_the_prompt_asks_for_each_point_by_its_cited_lines(self):
        model = ScriptedModel()
        ModelPlanter(model, self.repo).plant_per_point(self.change, self.points, self.targets, per_point=1, silence=1)
        prompts = [user for system, user in model.calls if system == PLANT_SYSTEM]
        self.assertEqual(len(prompts), 3)                     # one small request per point, one for the quiet lines
        self.assertIn("R1: cited lines 5-8", prompts[0])
        self.assertNotIn("R2: cited lines", prompts[0])
        self.assertIn("R2: cited lines 9-9", prompts[1])
        self.assertIn("NOT inside any of these cited lines", prompts[2])

    def test_a_point_marked_risky_gets_one_more_of_each(self):
        model = ScriptedModel()
        ModelPlanter(model, self.repo).plant_per_point(self.change, self.points, self.targets, per_point=1, silence=0, risky=["R1"])
        prompts = "\n".join(user for system, user in model.calls if system == PLANT_SYSTEM)
        self.assertIn("R1: cited lines 5-8. Propose 3 breaks", prompts)
        self.assertIn("R2: cited lines 9-9. Propose 2 breaks", prompts)

    def test_scoring_uses_the_reviewers_own_answer_not_our_citation_check(self):
        from reviewer_controls.controls import score
        from reviewer_controls.models import Plant, PointAssessment, ReviewResult
        plant = Plant(id="p1", kind=KIND_HARMLESS, description="", file="src/Calc.cs", line_start=9, line_end=9, near="R1")
        original = ReviewResult(reviewer="r", variant_id="original", points=[PointAssessment(id="R1", status="met", claimed_status="met")])
        # Our check lowered "met" to "cannot_tell" in the copy, but the reviewer itself still said met.
        copy = ReviewResult(reviewer="r", variant_id="p1", points=[PointAssessment(id="R1", status="cannot_tell", claimed_status="met")])
        outcome = score(plant, copy, original)
        self.assertTrue(outcome.correct)
        self.assertEqual((outcome.near_point, outcome.near_alarm), ("R1", False))
        withdrawn = ReviewResult(reviewer="r", variant_id="p1", points=[PointAssessment(id="R1", status="cannot_tell", claimed_status="cannot_tell")])
        outcome = score(plant, withdrawn, original)
        self.assertEqual((outcome.correct, outcome.near_alarm), (False, True))

    def test_a_very_broad_finding_in_the_real_change_does_not_rule_a_copy_out(self):
        from reviewer_controls.controls import score
        from reviewer_controls.models import Finding, Plant, ReviewResult
        plant = Plant(id="p1", kind="bug", description="", file="src/Calc.cs", line_start=40, line_end=40)
        broad = ReviewResult(reviewer="r", variant_id="original", findings=[Finding("src/Calc.cs", 1, 179, "everything")])
        self.assertFalse(score(plant, ReviewResult(reviewer="r", variant_id="p1"), broad).inconclusive)


class SmallPieceTests(unittest.TestCase):
    def test_extract_json_ignores_prose_and_fences(self):
        self.assertEqual(extract_json('Sure.\n```json\n{"a": [1, 2]}\n```\nDone.'), {"a": [1, 2]})
        with self.assertRaises(ModelError):
            extract_json("no json here")

    def test_extract_json_skips_fragments_that_are_not_the_answer(self):
        reply = 'The code indexes `refs[0]` and `{}` directly.\n{"meets_requirement": false, "findings": []}'
        self.assertEqual(extract_json(reply), [0])   # without guidance, the first fragment wins
        answer = extract_json(reply, accept=lambda value: isinstance(value, dict) and "findings" in value)
        self.assertEqual(answer, {"meets_requirement": False, "findings": []})
        with self.assertRaises(ModelError):
            extract_json("only refs[0] here", accept=lambda value: isinstance(value, dict))

    def test_a_point_called_met_without_lines_is_not_counted_as_met(self):
        points = [RequirementPoint("R1", "a"), RequirementPoint("R2", "b"), RequirementPoint("R3", "c")]
        raw = [
            {"id": "r1", "status": "Met", "evidence": [{"file": "A.cs", "line_start": "7"}], "reason": "x"},
            {"id": "R2", "status": "met", "evidence": []},
            {"id": "R9", "status": "met", "evidence": [{"file": "A.cs", "line_start": 1}]},
        ]
        parsed = parse_points(raw, points)
        self.assertEqual([(p.id, p.status) for p in parsed], [("R1", "met"), ("R2", "cannot_tell"), ("R3", "cannot_tell")])
        self.assertEqual(parsed[0].evidence, [{"file": "A.cs", "line_start": 7, "line_end": 7}])
        self.assertEqual(parse_points(None, []), [])

    def test_a_bug_must_change_code_not_just_comments_or_spacing(self):
        self.assertFalse(changes_code(["  x = 1;  // set x"], ["x=1; // assign"]))
        self.assertTrue(changes_code(["x = 1;"], ["x = 2;"]))
        head = "a\nx = 1; // note\nb"
        comment_only = {"kind": "bug", "line_start": 2, "line_end": 2, "original": "x = 1; // note", "replacement": "x = 1; // other"}
        self.assertIsNone(apply_edit("F.cs", head, [(2, 2)], comment_only))
        self.assertIsNotNone(apply_edit("F.cs", head, [(2, 2)], dict(comment_only, kind="harmless")))
        self.assertIsNotNone(apply_edit("F.cs", head, [(2, 2)], dict(comment_only, replacement="x = 2; // note")))

    def test_points_that_say_the_same_thing_are_merged(self):
        texts = [
            "The source generator does not throw IndexOutOfRangeException for a closed generic value type from a referenced assembly.",
            "The analyzer does not throw IndexOutOfRangeException for a closed generic value type from a referenced assembly.",
            "The generated output contains a resolver for the type.",
            "",
        ]
        self.assertEqual(merge_similar(texts), [texts[0], texts[2]])

    def test_a_citation_covering_too_many_lines_does_not_count(self):
        diff = "diff --git a/A.cs b/A.cs\n--- a/A.cs\n+++ b/A.cs\n@@ -1,0 +1,60 @@\n" + "+x\n" * 60
        raw = [{"id": "R1", "status": "met", "evidence": [{"file": "A.cs", "line_start": 1, "line_end": 60}]},
               {"id": "R2", "status": "met", "evidence": [{"file": "A.cs", "line_start": 1, "line_end": 60},
                                                         {"file": "A.cs", "line_start": 10, "line_end": 14}]}]
        first, second = check_evidence(parse_points(raw, [RequirementPoint("R1", "a"), RequirementPoint("R2", "b")]), diff)
        self.assertEqual((first.status, first.broad_evidence, first.evidence), ("cannot_tell", 1, []))
        self.assertIn("too broad", first.reason)
        self.assertEqual((second.status, second.broad_evidence, len(second.evidence)), ("met", 1, 1))

    def test_check_evidence_leaves_other_statuses_alone(self):
        points = parse_points([{"id": "R1", "status": "not_met", "evidence": []}], [RequirementPoint("R1", "a")])
        self.assertEqual(check_evidence(points, "")[0].status, "not_met")

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
