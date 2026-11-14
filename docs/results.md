# Results on Tieto's sample changes

Generated from the saved runs by `scripts/summarise_results.py`. Do not edit by hand.

Each reviewer saw exactly the same planted copies of a change. Planted copies were not
compiled or run, so some planted defects may not be real defects. Counts are small;
read the ranges, not the fractions.

## Pull request #1: Crash on a closed generic struct from a referenced assembly

4 files. 6 planted edits (2 bug, 2 harmless, 2 omission), written by DeepSeek-V4.1-Flash.

| Reviewer | Verdict on the real change | Planted defects caught | Supported claim | False alarms | Verdict moved when requirement altered | No answer |
|---|---|---|---|---|---|---|
| nemotron-3.5-super-vl | meets requirement | 1 of 3 | The true catch rate is between 6% and 79% (95% interval). | 0 of 2 | yes | 1 |
| gemma-4-31B-it | meets requirement | 2 of 4 | The true catch rate is between 15% and 85% (95% interval). | 0 of 2 | yes | 0 |

## Pull request #2: Analyzer does not run when SuppressSourceGeneration is true

4 files. 12 planted edits (4 bug, 4 harmless, 4 omission), written by DeepSeek-V4.1-Flash.

| Reviewer | Verdict on the real change | Planted defects caught | Supported claim | False alarms | Verdict moved when requirement altered | No answer |
|---|---|---|---|---|---|---|
| nemotron-3.5-super-vl | no usable answer | 2 of 5 | The true catch rate is between 12% and 77% (95% interval). | 1 of 4 | not tested | 3 |
| gemma-4-31B-it | could not tell | 3 of 8 | The true catch rate is between 14% and 69% (95% interval). | 0 of 4 | not tested | 0 |

## Pull request #3: Generate a formatter for a type in a referenced assembly

Not tested yet.

## Pull request #4: Add ExcludeFromCodeCoverage to generated code

Not tested yet.

## Pooled across all tested changes

| Reviewer | Planted defects caught | 95% interval | Bugs caught | Omissions caught | False alarms | No answer |
|---|---|---|---|---|---|---|
| nemotron-3.5-super-vl | 3 of 8 | 14% to 69% | 1 of 4 | 2 of 4 | 1 of 6 | 4 |
| gemma-4-31B-it | 5 of 12 | 19% to 68% | 3 of 6 | 2 of 6 | 0 of 6 | 0 |
