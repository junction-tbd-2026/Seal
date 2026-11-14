# Concept card: confidence is measured, not stated

**Challenge:** Tieto, Earned Trust in AI Code.
**Question:** How can AI review the code made by AI so that humans can trust it?

## Recommendation

**Don't ask the AI reviewer how sure it is. Test it on the change in front of
it, and let a named person sign only what the test could not prove.**

An AI reviewer's "looks good" is like the silence of a smoke detector: it
means nothing until someone presses the test button. We press it on every
pull request, at the exact lines the reviewer says prove its point, and we
also blow harmless smoke to see whether it shrieks at nothing.

Every pull request answers three questions, in this order, each with an owner:

1. **What does done mean?** A model drafts three to five objectives from the
   requirement, without seeing the code. **The owner of the requirement (for
   example the product owner) approves them**: keeps or strikes each one,
   marks the risky ones, adds what is missing. Everything after this is
   measured against the approved objectives.
2. **Can the AI be believed on this change?** The AI reviewer judges each
   objective (met, not met, cannot tell) and must cite the lines that show
   it. We then break those very lines in copies of the change, and make
   harmless edits to the same lines, and the reviewer reviews every copy
   blind. An objective is **Proven** only when the reviewer took back "met"
   every time we broke its lines (at least twice) and never on a harmless
   edit there.
3. **What is left for a person?** Proven objectives need no reading.
   Everything else goes to **the engineer who signs**: unproven objectives,
   the spots where the reviewer missed a break, the problems it reported in
   the real code. The engineer signs a receipt of what was proven, what they
   checked, what nobody could decide, and what nothing checked.

Line-by-line review of everything is the wrong default. Review the AI
reviewer's blind spots, and sign only what was proven.

## Principles

1. **Two decisions, two owners.** The owner of the requirement decides what
   done means. The engineer decides whether the code meets it. The AI decides
   nothing; its review is evidence.
2. **Trust comes from evidence about this change,** not from the reviewer's
   confidence or its score on a benchmark. The same reviewer can be sharp on
   one change and close to a coin flip on the next.
3. **Judge the reviewer as a detector.** A reviewer that reacts to every edit
   catches every planted bug. Breaks it noticed and harmless edits it ignored,
   in the same lines, are shown together, always.
4. **Test the silence too.** A few breaks go into changed lines nobody cited.
   The receipt states how many changed lines no test touched.
5. **Say only what the numbers support.** Small samples make a gate, not a
   rate. Rates come from pooling across changes in the trust ledger.
6. **The reviewer must not know it is being tested.** Each copy is reviewed
   alone, in a fresh session, with the normal prompt; a different model
   writes the edits.
7. **"Cannot tell" is a valid answer,** for the AI and for the person. It is
   listed on the receipt as risk accepted, not hidden.
8. **An approval nobody tested is a rubber stamp.** Now and then, as an
   agreed team drill, the code shown for sign-off is a planted copy. Only
   finding the planted spot counts as catching it.

## How it runs in a pull-request flow

1. An AI agent opens a pull request against a requirement.
2. Risk rule: a change over 100 files, a new dependency or a changed public
   interface goes straight to a full human read. The AI test is not used.
3. Objectives are drafted and **approved by the owner** (minutes per issue;
   best before the coding agent even starts).
4. The AI reviewer judges each objective, twice, and cites lines.
5. Paired planting: per objective, two breaks and two harmless edits in its
   cited lines (three each for objectives marked risky), plus two breaks in
   uncited lines.
6. The reviewer reviews every copy blind. Scoring uses only its own answers.
7. The pull request shows one line, for example "4 objectives approved · 2
   proven by test · 2 for you".
8. The engineer works through the gaps, one at a time, and signs the receipt.

## What the owner and the engineer sign

| On the receipt | Source |
|---|---|
| The approved objectives, who approved them, what was struck as out of scope | The owner's approval |
| Objectives proven by the test, with the breaks and harmless edits behind each | The planted copies |
| Objectives the engineer checked, and their answer (met, not met, cannot tell) | The sign-off |
| Each spot where the reviewer missed a break, with the engineer's verdict | The sign-off |
| Each problem the AI reported in the real code, judged real or not | The sign-off |
| What nothing checked: changed lines no planted edit touched, nothing run, design | Fixed list, counted per change |
| The engineer's name, decision and time taken | The sign-off |

## How trust is measured

The trust ledger counts Tieto's four measures from what reviewers and people
actually did, per reviewer and per code area:

| Tieto's measure | How it is counted |
|---|---|
| Share routed to humans | Approved objectives not proven by the test, as a share of all objectives |
| Time to merge | Time from opening the pull request to the signature, recorded with every sign-off |
| AI findings are real and accepted | Each finding judged real or not by the engineer |
| Reverts and incidents do not rise as review time falls | Escapes logged per area; an escape withdraws that area's trust, every objective goes back to a person and gets more planted breaks until the record recovers |
| Humans stay accountable | The spot-check drill: planted copies found by the signers |

Trust is earned per area: an area whose reviewer stays sharp needs fewer
planted breaks per objective over time; an escape resets it.

## Trade-offs

- **Cost and time.** Paired planting is about four copies per objective, so
  around 15 to 20 reviews per change, run in parallel. Proven areas get fewer
  over time. Large or risky changes skip the test and go to a person.
- **Owner time.** Approving objectives takes minutes, and it removes the
  biggest single error source: a checklist that measures the wrong thing.
- **What we check by rule, and what we do not.** By rule: citations must be
  lines in the change, at most 25 of them; a planted bug must change code;
  scoring uses the reviewer's own answers; a finding counts when it points at
  the edit or names what it removed. Not by rule: whether a planted bug really
  changes behaviour. That needs the code to run.
- **Optimism.** Planted defects are cruder than real ones. Catching them is
  necessary, not sufficient.

## Strength of evidence

| Strength | Evidence | Here |
|---|---|---|
| Weakest | An AI's opinion | Yes |
| | That opinion tested on this change, catches and false alarms together | Yes |
| | A claim tied to an approved objective and to lines | Yes |
| | Something that runs: the change's tests fail on the planted copies | Not yet |
| Strongest | An attack that tried to break the change and failed, on record | Not yet |

## Limits

- It never proves a change is correct. It shows where the reviewer's "met"
  and its silence are worth something, and where they are not.
- Design-level mistakes are out of reach.
- Planted copies are not yet built or run.
- A per-change result rests on few samples: a gate, not a grade.
- If the planter and the reviewer share a blind spot, that class of defect is
  never planted and never missed.
- The reviewer sees the diff, not the whole repository, so it can accuse a
  correct change (pull request #2). The engineer judges every finding.
- The spot-check drill only works as an agreed, no-blame practice.

## Results and failure modes

- Results on Tieto's sample changes: [results.md](results.md)
- Decisions made and failures seen: [lessons-log.md](lessons-log.md)
