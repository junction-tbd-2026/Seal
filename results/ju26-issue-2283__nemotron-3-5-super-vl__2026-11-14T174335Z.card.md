# Sign-off card: ju26-issue-2283

- Requirement: #2283
- Reviewer under test: nemotron-3.5-super-vl
- Planted by: deepseek-ai/DeepSeek-V4.1-Flash
- Run: 2026-11-14T17:43:35Z

## What the reviewer found in the real change

Verdict: the reviewer says the change **meets the requirement**.

No findings.

## How far to trust that review

- Planted defects: 3 of 6 caught. The true catch rate is between 19% and 81% (95% interval).
- Harmless edits: 0 of 4 wrongly flagged (false alarms).
- Altered requirement: the verdict changed, so the reviewer did check against the requirement.

## Read these lines yourself

The reviewer did not see a defect planted here, so its silence on these lines means little:

- `src/MessagePack.SourceGenerator/CodeAnalysis/TypeCollector.cs` around lines 1077-1077 (bug, medium): Uses DeclaringSyntaxReferences[0] instead of FirstOrDefault(), so a member whose type comes from a referenced assembly (no syntax in this compilation) throws IndexOutOfRangeException, which surfaces as CS8785 and suppresses the generated resolver.
- `src/MessagePack.SourceGenerator/CodeAnalysis/TypeCollector.cs` around lines 239-239 (bug, medium): The diagnostic filter is dropped, so diagnostics whose locations come from metadata (a referenced assembly) are reported to the analyzer. Roslyn forbids reporting a diagnostic against a location outside the compilation, so the analyzer throws and AD0001 is emitted again.
- `src/MessagePack.SourceGenerator/CodeAnalysis/TypeCollector.cs` around lines 1446-1446 (bug, medium): The ContainsSyntaxTree guard is dropped, so a diagnostic whose location belongs to a different compilation's syntax tree is passed to the analyzer's report callback. Analyzers may only report locations inside the compilation being analyzed, so the driver rejects them (AD0001) or reports diagnostics against foreign files.

## What the reviewer refused to decide

Nothing stated.

## Not checked

- Planted variants were not compiled or run, so some may not be real defects.
- Design-level mistakes and anything outside this diff.
- Planted defects are usually easier to catch than real ones, so the figures lean optimistic.
- The reviewer answered differently on two identical reviews for R4; those points are not scored.

## Cost

- 12 reviews, 80,059 tokens in and 196,056 out, 271 seconds.

## Sign-off

I have read the findings and the lines listed above, and I accept the remaining risk.

- Name: ______________________
- Decision: accept / reject / needs full read
- Date: ______________________
