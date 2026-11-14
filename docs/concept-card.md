# Concept card: test the reviewer, then sign

**Challenge:** Tieto, Earned Trust in AI Code.
**Question:** How can AI review the code made by AI so that humans can trust it?

## Recommendation

**Every claim points at evidence, and every approval is tested: the AI's and
the human's.**

1. Split the requirement into a few checkable points, written without sight
   of the code. The AI reviewer must say, for each point, whether the change
   meets it and which lines show it. Citations are checked: lines that are
   not in the change are thrown out, so is a citation of more than 25 lines,
   and a point left with nothing cited is "cannot tell", not "met".
2. Test the reviewer on this exact change. The real change is reviewed
   first. Then the very lines it cited for each point are broken, in a copy,
   to see whether it still says "met". Its "met" counts only where it
   noticed.
3. Test the person who signs. For a share of pull requests the code first
   shown for sign-off is one of those broken copies. Accepting it is
   recorded, and nothing is approved. Accept stays locked until the signer
   has opened every marked spot and said "looks right" or "looks wrong"
   for each. Those verdicts are stored with the signature.

The named owner signs what is left: the points, the evidence, and the spots
where nobody has shown the reviewer can see.

Line-by-line human review of everything is the wrong default. Line-by-line
review of the places where the AI reviewer proved blind is the right one.

## Principles

1. **Trust comes from evidence about this change,** not from the reviewer's
   confidence or its score on someone else's benchmark. Evidence is tied to a
   requirement point and to specific lines.
2. **A named human owns every decision.** The AI review is advice with
   evidence. It is never the approval.
3. **Measure both ways.** Planted bugs and omissions measure what the reviewer
   misses. Planted harmless rewrites measure what it wrongly reports.
4. **Say only what the numbers support.** Results are ranges. Small samples
   are shown as small samples.
5. **Silence has to be earned.** "No findings" counts for something only in
   areas where the reviewer caught what was planted.
6. **The reviewer must not know it is being tested.** Each planted copy is
   reviewed alone, in a fresh session, with the normal prompt, and the edits
   are written by a different model.
7. **Refusing to decide is a valid answer.** What the reviewer could not
   settle, and what nobody checked, is listed on the card.
8. **An approval nobody tested is a rubber stamp.** The same instrument that
   measures the AI reviewer measures the human signer. Airports do this to
   their screeners. It is an announced policy, never a secret one.

## How it runs in a pull-request flow

1. An AI agent opens a pull request against a requirement.
2. The check starts automatically. The requirement is split into points.
3. The AI reviewer judges each point on the real change, twice, and cites
   lines for each.
4. A planter model writes small edits inside the cited lines: bugs,
   omissions and harmless rewrites. Every point the reviewer called met gets
   at least one break before any point gets a second.
5. The reviewer judges every planted copy, blind. A planted defect is caught
   when the reviewer flags the spot or stops calling that point met.
6. The review is rerun with the requirement altered. If the verdict does not
   move, the reviewer was not checking against the requirement.
7. The pull request gets a status and a link, for example "caught 1 of 3
   planted defects, 2 places need a human".
8. The owner opens the link, reads the marked lines, gives a verdict on
   each, and signs: accept, reject, or send for a full read. The first copy
   shown may be a spot-check.

## What the owner signs

| On the card | Source |
|---|---|
| Each requirement point: met, not met or cannot tell, with the lines cited | The review |
| For each point, whether the reviewer noticed when it was broken | The planted copies |
| What the reviewer found in the real change, and its verdict against the requirement | The review |
| How many planted defects it caught, as a range | The planted copies |
| How many harmless rewrites it wrongly reported | The planted copies |
| Whether its verdict depends on the requirement | The altered-requirement rerun |
| The lines where a planted defect went unseen | Scoring |
| What the reviewer refused to decide | The review |
| What was not checked at all | Fixed list, stated every time |
| The owner's name, decision, time and verdict on each marked spot | The sign-off |

## How trust is measured

Per change, the card gives a gate and a to-do list, not a statistic. The
statistic comes from pooling: every planted edit is a labelled test, so a
team accumulates a catch rate and a false-alarm rate **per reviewer, per code
area, per kind of defect**. That record decides how much review a change
gets, and it is withdrawn when a real defect escapes.

| Tieto's measure | How this concept produces it |
|---|---|
| AI findings are real and accepted | False-alarm rate on harmless rewrites; owner's decision recorded per card |
| Share routed to humans | Lines marked "read yourself" as a share of changed lines |
| Reverts and incidents do not rise as review time falls | Escapes are logged against the area and lower its trust; planted-catch rate must stay above the area's floor |
| Time to merge | Time from pull request to signature, recorded on the card |
| Humans stay accountable | Share of spot-check copies each signer refuses, and share where they marked the planted spot itself as wrong; an accepted copy is logged with the time taken |

## Depth follows risk

| Risk of the change | Planted edits | What the human does |
|---|---|---|
| Low: tests, docs, generated files | 3 to 5, spot-checked | Signs the card |
| Medium: ordinary product code | About 10 | Reads the marked lines, then signs |
| High: security, money, core libraries, public interfaces | About 30, plus real past bugs from the project's history | Full read, with the card as a guide |
| New dependency, changed public interface, very large change | Not applicable | Always a human decision; the AI is not asked to approve design |

Ten planted defects, all caught, supports "at least 74%" at 95% confidence.
Thirty supports "at least 90%". The tier sets the number.

## Trade-offs

- **Cost and time.** Each planted copy is one more review. Ten copies means
  eleven reviews. Tiering and spot-checking keep this proportionate.
- **What we check by rule, and what we do not.** By rule: a planted bug must
  change code, not comments; a citation must point at lines in the change
  and cover at most 25 of them; a planted break is credited to a point only when it sits inside the lines the
  reviewer cited for that point; a point whose answer changes between two
  identical reviews is not scored. Not by rule: whether a planted bug really
  changes behaviour. That needs the code to run.
- **Optimism.** Planted defects are usually easier to catch than real ones.
  Reversing real past bug fixes from the project's history narrows the gap.
- **Noise versus coverage.** A stricter reviewer catches more and raises more
  false alarms. The harmless rewrites make that visible instead of hidden.

## Strength of evidence

| Strength | Evidence | Here |
|---|---|---|
| Weakest | An AI's opinion | Yes |
| | That opinion with a measured error rate | Yes |
| | A claim tied to a requirement point and to lines | Yes |
| | Something that runs: tests pass with the change and fail without it | Not yet |
| Strongest | An attack that tried to break the change and failed, on record | Not yet |

The two missing rungs need the code built and run. They are the next step,
not a different idea: the planted copies become the test of the attacker.

## Limits

- It never proves a change is correct. It tells you where the reviewer's
  silence is worth something and where it is not.
- Design-level mistakes are out of reach.
- Missing work is only partly covered, through planted omissions.
- If the planter and the reviewer share a blind spot, that class of defect is
  never planted and never missed.
- A per-change result rests on few samples. Treat it as a gate, not a grade.
- A point whose only cited proof is a test is marked as such, because the
  tests are not run here.
- The requirement points are written by a model. A wrong or missing point
  goes unnoticed unless the owner reads the requirement.
- Spot-checking people only works as an agreed practice. Done covertly it
  costs more trust than it earns.

## Results and failure modes

- Results on Tieto's four sample changes: [results.md](results.md)
- Decisions made and failures seen: [lessons-log.md](lessons-log.md)
