# Sign-off card: ju26-issue-2129

- Requirement: #2129
- Reviewer under test: nemotron-3.5-super-vl
- Planted by: deepseek-ai/DeepSeek-V4.1-Flash
- Run: 2026-11-14T19:08:20Z

## What the reviewer found in the real change

Verdict: the reviewer says the change **meets the requirement**.

No findings.

## How far to trust that review

- Planted defects: 2 of 6 caught. The true catch rate is between 10% and 70% (95% interval).
- Harmless edits: 0 of 3 wrongly flagged (false alarms).
- Altered requirement: the verdict changed, so the reviewer did check against the requirement.

## Read these lines yourself

The reviewer did not see a defect planted here, so its silence on these lines means little:

- `src/MessagePack.SourceGenerator/CodeAnalysis/GeneratedFormatterCollector.cs` around lines 64-66 (bug, medium): The accessibility check is neutered by comparing the type against itself, so a type that is not accessible from the formatter's compilation is accepted and the generated formatter will not compile.
- `src/MessagePack.SourceGenerator/CodeAnalysis/GeneratedFormatterCollector.cs` around lines 110-110 (bug, medium): The computed isIntKey value is discarded and false is always passed, so a surrogate using integer keys produces a string-keyed formatter and the generated code no longer matches the declared keys.
- `src/MessagePack.SourceGenerator/CodeAnalysis/GeneratedFormatterCollector.cs` around lines 123-123 (omission, easy): The model is returned with an empty set of object infos, so no formatter implementation is emitted for the annotated partial class.
- `src/MessagePack.SourceGenerator/CodeAnalysis/GeneratedFormatterCollector.cs` around lines 112-112 (omission, medium): Callback receiver support is hard-coded off, so OnBeforeSerialize/OnAfterDeserialize are never invoked in the generated formatter.

## What the reviewer refused to decide

Nothing stated.

## Not checked

- Planted variants were not compiled or run, so some may not be real defects.
- Design-level mistakes and anything outside this diff.
- Planted defects are usually easier to catch than real ones, so the figures lean optimistic.
- The reviewer answered differently on two identical reviews for R4; those points are not scored.
- Review of p03 failed and is left out of the score: nemotron-3.5-super-vl gave an empty answer (finish_reason=length, 201933 characters of thinking). It probably spent the whole reply budget of 45000 tokens thinking; raise the budget.

## Cost

- 12 reviews, 226,815 tokens in and 161,705 out, 138 seconds.

## Sign-off

I have read the findings and the lines listed above, and I accept the remaining risk.

- Name: ______________________
- Decision: accept / reject / needs full read
- Date: ______________________
