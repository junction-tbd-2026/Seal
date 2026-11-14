# Lessons log

Decisions made and failures seen while building, in the order they happened.
Each entry says what we expected, what happened, and what we changed.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Test the reviewer on the change in front of us, not on a benchmark. | A benchmark score says how a reviewer does on average. The person signing needs to know how it did on this code. |
| 2 | Plant three kinds of edit: bugs, omissions and harmless rewrites. | Bugs alone reward a reviewer that flags everything. Harmless rewrites measure false alarms. Omissions cover the most common agent failure, missing work, which has no wrong line to find. |
| 3 | A different model writes the planted edits than reviews them. | A reviewer graded on bugs in its own style looks better than it is. |
| 4 | Each planted copy is reviewed alone, in a fresh session, with the normal review prompt. | If the reviewer sees the original beside a copy, or is told it is a test, the result measures nothing. |
| 5 | Report a range, never a single score. | A handful of planted edits cannot support a precise number. Ten caught out of ten supports "at least 74%", not "100%". |
| 6 | A spot the reviewer already flagged in the real change is left out of the score. | Flagging it again in a planted copy proves nothing about the planted edit. |
| 7 | A failed review is left out of the score and said so on the card. | Counting it as a miss or a catch would both be wrong. |
| 8 | The card lists the exact lines where a planted defect went unseen. | "Catch rate 33%" tells a human nothing to do. "Read lines 239 and 1446" does. |
| 9 | Rerun the review with the requirement altered. | If the verdict does not change, the reviewer was not checking against the requirement. |
| 10 | Keys live in one file outside the repository; a commit check blocks any commit containing one. | The repository is public. |

## Failures we saw

| # | What happened | What it taught us | What we changed |
|---|---|---|---|
| 1 | The first real review returned nothing. The reviewer had used its entire reply budget thinking and never reached its answer. | Reviewers that reason before answering can fail silently on real changes while passing a small test. | Larger reply budgets per model, and an explicit error that says the budget ran out. |
| 2 | The first planter model thought for about five minutes and was cut off as it began to answer. | The strongest model is not the right planter if it cannot finish. | Switched planter; told it to pick edits without long deliberation. |
| 3 | Models quote line numbers unreliably. | A planted edit placed by line number alone can land on the wrong line. | Every proposed edit must quote the text it replaces. The quote is checked, and it overrides the line number. |
| 4 | Even with a larger budget, one of six planted copies got no answer from the main reviewer. | "No answer" is a real outcome and has to be shown, not hidden. | It is reported per copy and excluded from the score. |
| 5 | On the first change both reviewers missed the same two planted bugs and caught the planted omissions. | Reviewers may be better at "required behaviour is gone" than at "this line is subtly wrong". Too few samples to conclude. | Run more planted edits per change and more changes before claiming it. |
| 6 | A large reviewer and a much smaller open one scored similarly on the first change. | Model size did not predict catch rate here. Again, too few samples. | Keep testing both on identical planted edits. |

## What we would not trust in our own output

- **Whether a planted bug is a real bug.** Planted copies are not yet compiled or run. Some may change nothing.
- **Any per-change percentage.** With three to twelve planted defects the interval is wide.
- **Silence about design.** A change that is well-written but the wrong design passes every check here.
- **Results when planter and reviewer share blind spots.** If neither model can imagine a class of bug, it is never planted and never missed.
