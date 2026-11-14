# Sign-off card: ju26-issue-2283

- Requirement: #2283
- Reviewer under test: nemotron-3.5-super-vl
- Planted by: deepseek-ai/DeepSeek-V4.1-Flash
- Run: 2026-11-14T15:01:01Z

## What the reviewer found in the real change

Verdict: the reviewer says the change **meets the requirement**.

- `src/MessagePack.SourceGenerator/CodeAnalysis/TypeCollector.cs` lines 1444-1450 (major): ReportIfLocatedInCompilation accesses diagnostic.Location.IsInSource without a null check. When GetPropertyIdentifierLocation (line 985) or the inline FirstOrDefault()?.GetSyntax().GetLocation() (line 1077) returns null for a metadata symbol, Diagnostic.Create produces a diagnostic with a null location, causing a NullReferenceException in ReportIfLocatedInCompilation. This crashes the analyzer/generator for closed generic value types from referenced assemblies that have unkeyed public members, replacing the original IndexOutOfRangeException with a different crash.

## How far to trust that review

- Planted defects: 3 of 4 caught. The true catch rate is between 30% and 95% (95% interval).
- Harmless edits: 1 of 3 wrongly flagged (false alarms).
- Altered requirement: the verdict changed, so the reviewer did check against the requirement.
- 1 planted variant(s) were left out: the reviewer had already flagged that spot in the real change.

## Read these lines yourself

The reviewer did not see a defect planted here, so its silence on these lines means little:

- `src/MessagePack.SourceGenerator/CodeAnalysis/TypeCollector.cs` around lines 239-239 (bug, medium): The diagnostic filter is dropped, so diagnostics whose locations come from metadata (a referenced assembly) are reported to the analyzer. Roslyn forbids reporting a diagnostic against a location outside the compilation, so the analyzer throws and AD0001 is emitted again.

## What the reviewer refused to decide

- Cannot determine from the diff whether all three direct-indexing locations in GetObjectInfo (lines 735, 1009, 1101 in the referenced version) are fixed, as only two diagnostic sites are shown changed.

## Not checked

- Planted variants were not compiled or run, so some may not be real defects.
- Design-level mistakes and anything outside this diff.
- Planted defects are usually easier to catch than real ones, so the figures lean optimistic.
- Review of p04 failed and is left out of the score: the model reply contained no usable JSON answer
- Review of p08 failed and is left out of the score: nemotron-3.5-super-vl gave an empty answer (finish_reason=length, 135042 characters of thinking). It probably spent the whole reply budget of 32000 tokens thinking; raise the budget.
- Rescored 2026-11-14 15:14 UTC from the saved reviews with the current rules: stability compares the reviewer's own answers, and an alarm on a harmless edit counts against the point it sits in.

## Cost

- 12 reviews, 73,831 tokens in and 157,360 out, 105 seconds.

## Sign-off

I have read the findings and the lines listed above, and I accept the remaining risk.

- Name: ______________________
- Decision: accept / reject / needs full read
- Date: ______________________
