# Sign-off card: ju26-issue-2283

- Requirement: #2283
- Reviewer under test: nemotron-3.5-super-vl
- Planted by: deepseek-ai/DeepSeek-V4.1-Flash
- Run: 2026-11-14T05:23:07Z

## What the reviewer found in the real change

Verdict: the reviewer says the change **meets the requirement**.

No findings.

## How far to trust that review

- Planted defects: 5 of 7 caught. The true catch rate is between 36% and 92% (95% interval).
- Harmless edits: 2 of 3 wrongly flagged (false alarms).
- Altered requirement: the verdict changed, so the reviewer did check against the requirement.

## Read these lines yourself

The reviewer did not see a defect planted here, so its silence on these lines means little:

- `src/MessagePack.SourceGenerator/CodeAnalysis/TypeCollector.cs` around lines 239-239 (bug, medium): Bypasses the ReportIfLocatedInCompilation filter entirely. The analyzer will report diagnostics for symbols from referenced assemblies, which can have locations outside the compilation and cause AD0001.
- `src/MessagePack.SourceGenerator/CodeAnalysis/TypeCollector.cs` around lines 239-239 (omission, medium): Omits the ReportIfLocatedInCompilation wrapper so diagnostics for metadata symbols are reported directly. Analyzers are not permitted to report against locations outside the compilation, which causes AD0001.

## What the reviewer refused to decide

Nothing stated.

## Not checked

- Planted variants were not compiled or run, so some may not be real defects.
- Design-level mistakes and anything outside this diff.
- Planted defects are usually easier to catch than real ones, so the figures lean optimistic.

## Cost

- 12 reviews, 80,636 tokens in and 207,426 out, 127 seconds.

## Sign-off

I have read the findings and the lines listed above, and I accept the remaining risk.

- Name: ______________________
- Decision: accept / reject / needs full read
- Date: ______________________
