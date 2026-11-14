# Concept card: test the reviewer, then sign

**Challenge:** Tieto, Earned Trust in AI Code.
**Question:** How can AI review the code made by AI so that humans can trust it?

## Recommendation

Do not ask a human to trust an AI reviewer's "looks good". Test the reviewer
on the change in front of it, every time: plant known defects in copies of the
change and see which ones it catches. Give the named owner a one-page card
with the reviewer's findings, what it demonstrably missed, and the exact lines
to read personally. The owner signs the card, not the diff.

Line-by-line human review of everything is the wrong default. Line-by-line
review of the places where the AI reviewer proved blind is the right one.

## Principles

1. **Trust comes from evidence about this change,** not from the reviewer's
   confidence or its score on someone else's benchmark.
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

## How it runs in a pull-request flow

1. An AI agent opens a pull request against a requirement.
2. The check starts automatically. A planter model writes small edits to the
   changed lines: bugs, omissions and harmless rewrites.
3. The AI reviewer reviews the real change and every planted copy, blind.
4. Findings are matched to the planted locations and scored.
5. The review is rerun with the requirement altered. If the verdict does not
   move, the reviewer was not checking against the requirement.
6. The pull request gets a status and a link, for example "caught 1 of 3
   planted defects, 2 places need a human".
7. The owner opens the link, reads the marked lines, and signs: accept,
   reject, or send for a full read.

## What the owner signs

| On the card | Source |
|---|---|
| What the reviewer found in the real change, and its verdict against the requirement | The review |
| How many planted defects it caught, as a range | The planted copies |
| How many harmless rewrites it wrongly reported | The planted copies |
| Whether its verdict depends on the requirement | The altered-requirement rerun |
| The lines where a planted defect went unseen | Scoring |
| What the reviewer refused to decide | The review |
| What was not checked at all | Fixed list, stated every time |
| The owner's name, decision and time | The sign-off |

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
- **Optimism.** Planted defects are usually easier to catch than real ones.
  Reversing real past bug fixes from the project's history narrows the gap.
- **Noise versus coverage.** A stricter reviewer catches more and raises more
  false alarms. The harmless rewrites make that visible instead of hidden.

## Limits

- It never proves a change is correct. It tells you where the reviewer's
  silence is worth something and where it is not.
- Design-level mistakes are out of reach.
- Missing work is only partly covered, through planted omissions.
- If the planter and the reviewer share a blind spot, that class of defect is
  never planted and never missed.
- A per-change result rests on few samples. Treat it as a gate, not a grade.

## Results and failure modes

- Results on Tieto's four sample changes: [results.md](results.md)
- Decisions made and failures seen: [lessons-log.md](lessons-log.md)
