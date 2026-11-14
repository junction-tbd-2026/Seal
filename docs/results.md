# Results on Tieto's sample changes

Generated from the saved runs by `scripts/summarise_results.py`. Do not edit by hand.

Each reviewer saw exactly the same planted copies of a change. Planted copies were not
compiled or run, so some planted defects may not be real defects. Counts are small;
read the ranges, not the fractions.

## Pull request #1: Crash on a closed generic struct from a referenced assembly

4 files. 10 planted edits (4 bug, 3 harmless, 3 omission), written by DeepSeek-V4.1-Flash.

| Reviewer | Verdict on the real change | Planted defects caught | Supported claim | False alarms | Verdict moved when requirement altered | No answer |
|---|---|---|---|---|---|---|
| nemotron-3.5-super-vl | meets requirement | 5 of 7 | The true catch rate is between 36% and 92% (95% interval). | 2 of 3 | yes | 0 |
| gemma-4-31B-it | meets requirement | 0 of 7 | The true catch rate is between 0% and 35% (95% interval). | 0 of 3 | yes | 0 |

## Pull request #2: Analyzer does not run when SuppressSourceGeneration is true

4 files. 10 planted edits (4 bug, 3 harmless, 3 omission), written by DeepSeek-V4.1-Flash.

| Reviewer | Verdict on the real change | Planted defects caught | Supported claim | False alarms | Verdict moved when requirement altered | No answer |
|---|---|---|---|---|---|---|
| nemotron-3.5-super-vl | does not meet | 0 of 0 | nothing scored | 0 of 0 | not tested | 1 |
| gemma-4-31B-it | meets requirement | 1 of 6 | The true catch rate is between 3% and 56% (95% interval). | 0 of 3 | yes | 1 |

## Pull request #3: Generate a formatter for a type in a referenced assembly

Not tested yet.

## Pull request #4: Add ExcludeFromCodeCoverage to generated code

Not tested yet.

## Pooled across all tested changes

| Reviewer | Planted defects caught | 95% interval | Bugs caught | Omissions caught | False alarms | No answer |
|---|---|---|---|---|---|---|
| nemotron-3.5-super-vl | 5 of 7 | 36% to 92% | 3 of 4 | 2 of 3 | 2 of 3 | 1 |
| gemma-4-31B-it | 1 of 13 | 1% to 33% | 1 of 8 | 0 of 5 | 0 of 6 | 1 |
