# Table sizing investigation

Synthetic content for CARD-0048. Toggle each table's Wrap table text control to
compare the shipped fixed/wrapped and automatic/no-wrap layouts.

## Compact mixed columns

| ID | State | Detail |
| ---: | :---: | :--- |
| 7 | OK | Retry in ten minutes |
| 104 | Waiting | Saved |
| 2 | Ready | No action required |

## Long prose

| ID | State | Explanation |
| ---: | :---: | :--- |
| 7 | OK | The service retains the previous result while a background refresh checks the remote endpoint and records the response for the next request. |
| 104 | Waiting | The operation will resume after the connection becomes available. |
| 2 | Ready | Saved |

## Header dominates

| ID | Human readable status description | N |
| --- | --- | ---: |
| 1 | OK | 3 |
| 2 | Done | 17 |

## Inline markup and unbroken code

| ID | Status | Token |
| --- | --- | --- |
| **7** | [Ready](#long-prose) | `abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789` |
| 42 | Waiting | `short` |

## Many short columns

| A | B | C | D | E | F | G | H | I | J | K | L |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | two | 3 | four | 5 | six | 7 | eight | 9 | ten | 11 | twelve |
| a | b | c | d | e | f | g | h | i | j | k | l |

## One column

| Flag |
| --- |
| Yes |
| No |

## Empty body cell

| ID | Optional | Description |
| ---: | --- | --- |
| 1 | | None |
| 2 | | A short explanation |

## Nested table

> | ID | Status | Detail |
> | --- | --- | --- |
> | 1 | OK | A nested table |
> | 22 | Waiting | Saved |
