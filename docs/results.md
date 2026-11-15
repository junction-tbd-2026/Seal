# Results on Tieto's sample changes

Generated from the saved runs by `scripts/summarise_results.py`. Do not edit by hand.

Each reviewer saw exactly the same planted copies of a change. Planted copies were not
compiled or run, so some planted defects may not be real defects. Counts are small;
read the ranges, not the fractions.

## Pull request #1: Crash on a closed generic struct from a referenced assembly

4 files. 10 planted edits (4 bug, 3 harmless, 3 omission), written by DeepSeek-V4.1-Flash.

| Reviewer | Verdict on the real change | Planted defects caught | Supported claim | False alarms | Verdict moved when requirement altered | No answer |
|---|---|---|---|---|---|---|
| gemini-4-hydrogen | could not tell | 6 of 7 | The true catch rate is between 49% and 97% (95% interval). | 0 of 3 | not tested | 0 |
| nemotron-3.5-super-vl | could not tell | 4 of 7 | The true catch rate is between 25% and 84% (95% interval). | 1 of 3 | not tested | 0 |

## Pull request #2: Analyzer does not run when SuppressSourceGeneration is true

4 files. 10 planted edits (4 bug, 3 harmless, 3 omission), written by DeepSeek-V4.1-Flash.

| Reviewer | Verdict on the real change | Planted defects caught | Supported claim | False alarms | Verdict moved when requirement altered | No answer |
|---|---|---|---|---|---|---|
| gemini-4-hydrogen | could not tell | 5 of 7 | The true catch rate is between 36% and 92% (95% interval). | 0 of 3 | not tested | 0 |
| nemotron-3.5-super-vl | does not meet | 0 of 0 | nothing scored | 0 of 0 | not tested | 0 |

## Pull request #3: Generate a formatter for a type in a referenced assembly

28 files. 10 planted edits (4 bug, 3 harmless, 3 omission), written by DeepSeek-V4.1-Flash.

| Reviewer | Verdict on the real change | Planted defects caught | Supported claim | False alarms | Verdict moved when requirement altered | No answer |
|---|---|---|---|---|---|---|
| gemini-4-hydrogen | meets requirement | 6 of 6 | This supports a catch rate of at least 61% (95% confidence). | 0 of 3 | yes | 0 |
| nemotron-3.5-super-vl | meets requirement | 2 of 6 | The true catch rate is between 10% and 70% (95% interval). | 0 of 3 | yes | 1 |

## Pull request #4: Add ExcludeFromCodeCoverage to generated code

Not tested yet.

## Pooled across all tested changes

| Reviewer | Planted defects caught | 95% interval | Bugs caught | Omissions caught | False alarms | No answer |
|---|---|---|---|---|---|---|
| gemini-4-hydrogen | 17 of 20 | 64% to 95% | 9 of 11 | 8 of 9 | 0 of 9 | 0 |
| nemotron-3.5-super-vl | 6 of 13 | 23% to 71% | 3 of 7 | 3 of 6 | 1 of 6 | 1 |
