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
| 11 | The requirement, split into points, is the spine of the page. Every point needs lines cited or it is "cannot tell". | A first-time user could not see how planted mistakes related to the real change. A score for the reviewer said nothing about the change itself. |
| 12 | A planted defect also counts as caught when the reviewer stops calling the broken point "met". | A reviewer can notice that required behaviour is gone without pointing at the exact line. |
| 13 | The person signing is spot-checked with a planted copy, at a spot the page already marks for them. | AI review makes rubber-stamping easy. An approval that is never tested carries no information. |
| 14 | A spot-check stays in place across page reloads until it is signed, and never records an approval. | Our first version was used up by a page reload before anyone saw it. |
| 15 | The checklist is written from the requirement alone. | Written with the code in view, the points described what the code did and were bound to come out "met". |
| 16 | A citation must point at lines in the change, or it is thrown out. | Requiring a citation is worthless if any line number will do. |
| 17 | A planted break is credited to a point only when it sits inside the lines the reviewer cited for it. | "This edit breaks R1" was only the planter's word. "We broke the lines you pointed at and you still said met" needs nobody's word. |
| 18 | The unchanged change is reviewed twice; a point that gets two different answers is not scored. | Otherwise a change of answer caused by chance is counted as a catch. |
| 19 | A harmless edit also counts as a false alarm when the reviewer withdraws a "met". | The reviewer can cry wolf without pointing at a line. |
| 20 | Only a share of pull requests is spot-checked, and the page says so. | A check on every first opening is predictable after one surprise. |
| 21 | Accept is locked until every marked spot has been opened. | In our own trial a person accepted a planted copy within seconds, without looking at anything. |
| 22 | One reviewer is shown by default; the comparison is one click away. | A signer does not need two machines disagreeing. Comparing reviewers is a question for whoever chooses the reviewer. |
| 23 | The real change is reviewed before anything is planted, and the planted breaks go inside the lines the reviewer cited. Every point gets one break before any gets a second. | Planting first and hoping the edits landed in cited lines left most points untested. |
| 24 | A citation of more than 25 lines does not count, and near-duplicate checklist points are merged. | A reviewer that cites a whole file has pointed at nothing, and any break in that file would be credited to the point. |
| 25 | The signer gives a verdict on each marked spot, "looks right" or "looks wrong". Accept needs every verdict, and none of them "wrong". | Opening a spot is a click. A verdict is a statement the signer can be held to, and the spot-check can compare it with what was planted. |
| 26 | A point whose only cited proof is a test is labelled on the page. | The tests are not run here, so a test that exists says less than it seems to. |
| 27 | The owner of the requirement approves the objectives before the review counts. | A company representative put it plainly: the review is only as good as the composed objectives. On pull request #3 the AI's whole "does not meet" rested on one objective taken from the issue author thinking aloud. |
| 28 | The reviewer is judged as a detector: breaks it noticed and harmless edits it alarmed on, shown together, with one word (sharp, jumpy, blind, mixed). | On pull request #1 the reviewer noticed 71% of breaks and alarmed on 67% of harmless edits: the headline 5 of 7 hid that. |
| 29 | Paired planting: two breaks and two harmless edits inside each objective's cited lines, plus breaks in uncited lines. | Harmless edits placed anywhere could not show whether the reviewer tells a break from a harmless edit at the place its claim rests on. |
| 30 | An objective is Proven only after two or more breaks, each making the reviewer take back "met", and no alarm on a harmless edit there. Proven objectives need no reading. | The earlier "held up" label rested on single breaks and on line flags where the reviewer still said "met". |
| 31 | Scoring uses the reviewer's own answers; a finding also counts when it names what the planted edit removed; findings over 25 lines count for nothing. | Our citation check was being scored as the reviewer noticing things, one 179-line finding voided nine copies, and a correct "defined but never called" was scored a miss. |
| 32 | Changes over 100 files go to a full human read by rule. | Depth of review follows risk; a 237-file change is not something an AI review, or a test of one, can vouch for. |
| 33 | The spot-check counts a catch only when the signer marks the planted spot itself as wrong, and the page never receives planted text at a spot it asks about. | Asking for a full read every time scored 100%, and the page used to show the planted line before signing. |
| 34 | Every answer the signer gives is stored with the sign-off, checks are saved per person, and the server refuses an accept the page should not have allowed. | Answers that live only in one browser cannot be audited, and two people on one laptop shared each other's checks. |

## Failures we saw

| # | What happened | What it taught us | What we changed |
|---|---|---|---|
| 1 | The first real review returned nothing. The reviewer had used its entire reply budget thinking and never reached its answer. | Reviewers that reason before answering can fail silently on real changes while passing a small test. | Larger reply budgets per model, and an explicit error that says the budget ran out. |
| 2 | The first planter model thought for about five minutes and was cut off as it began to answer. | The strongest model is not the right planter if it cannot finish. | Switched planter; told it to pick edits without long deliberation. |
| 3 | Models quote line numbers unreliably. | A planted edit placed by line number alone can land on the wrong line. | Every proposed edit must quote the text it replaces. The quote is checked, and it overrides the line number. |
| 4 | Even with a larger budget, one of six planted copies got no answer from the main reviewer. | "No answer" is a real outcome and has to be shown, not hidden. | It is reported per copy and excluded from the score. |
| 5 | On an early run of the first change both reviewers missed the same two planted bugs and caught the planted omissions; on the later run Gemma caught none of either. | Per-change results swing with few samples; an early pattern was not a finding. | Run more planted edits per change and more changes before claiming it. |
| 6 | A large reviewer and a much smaller open one scored similarly on an early run of the first change. | Model size did not predict catch rate there. Again, too few samples. | Keep testing both on identical planted edits. On the three changes with results, the larger model noticed far more breaks. |
| 7 | Several reviews were thrown away because the reply contained a fragment like `items[0]` before the answer, and that fragment was read as the answer. | Model replies need to be searched for the answer, not read from the first thing that parses. | The reader now looks for the first value shaped like an answer. |
| 8 | The first page was a scrolling story with a headline. Users asked when anyone would open it. | A review tool lives where the work is: on a pull request. | Rebuilt as a list of pull requests with a workspace per pull request. |
| 9 | With breaks planted before the review, only two of five points on the first change received a break that could be counted. | A test nobody aimed tests little. | See decision 23. |
| 10 | On pull request #2 the reviewer said the edits do not reach the analyzer. They do: the analyzer calls the changed code. | A reviewer that sees only the diff can accuse a correct change, and planted copies never test accusations. | The engineer judges every finding as real or not; repository context for the reviewer is the next step. |
| 11 | Asked for every objective's edits in one request, the planter thought until its reply budget ran out and returned nothing, and the run went on to review zero copies. | Bigger requests to a thinking model fail all at once. | One small request per objective; a run with nothing planted stops. |
| 12 | The same reviewer was sharp on pull request #3 (6 of 7 breaks, no false alarms) and close to chance on #1. | A reviewer's average says little about the next change. | This is the case for testing on every change, and it leads the pitch. |

## What we would not trust in our own output

- **Whether a planted bug is a real bug.** Planted copies are not yet compiled or run. Some may change nothing.
- **Any per-change percentage.** With three to twelve planted defects the interval is wide.
- **Silence about design.** A change that is well-written but the wrong design passes every check here.
- **Results when planter and reviewer share blind spots.** If neither model can imagine a class of bug, it is never planted and never missed.
