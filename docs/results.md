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

28 files. 12 planted edits (4 bug, 4 harmless, 4 omission), written by DeepSeek-V4.1-Flash.

| Reviewer | Verdict on the real change | Planted defects caught | Supported claim | False alarms | Verdict moved when requirement altered | No answer |
|---|---|---|---|---|---|---|
| nemotron-3.5-super-vl | meets requirement | 8 of 8 | This supports a catch rate of at least 69% (95% confidence). | 0 of 3 | yes | 1 |
| gemma-4-31B-it | meets requirement | 1 of 8 | The true catch rate is between 2% and 47% (95% interval). | 0 of 4 | yes | 0 |

## Pull request #4: Add ExcludeFromCodeCoverage to generated code

237 files. 8 planted edits (3 bug, 2 harmless, 3 omission), written by DeepSeek-V4.1-Flash.

| Reviewer | Verdict on the real change | Planted defects caught | Supported claim | False alarms | Verdict moved when requirement altered | No answer |
|---|---|---|---|---|---|---|
| nemotron-3.5-super-vl | meets requirement | 5 of 6 | The true catch rate is between 44% and 97% (95% interval). | 2 of 2 | yes | 0 |

## Pooled across all tested changes

| Reviewer | Planted defects caught | 95% interval | Bugs caught | Omissions caught | False alarms | No answer |
|---|---|---|---|---|---|---|
| nemotron-3.5-super-vl | 16 of 22 | 52% to 87% | 8 of 11 | 8 of 11 | 3 of 11 | 5 |
| gemma-4-31B-it | 6 of 20 | 15% to 52% | 4 of 10 | 2 of 10 | 0 of 10 | 0 |
