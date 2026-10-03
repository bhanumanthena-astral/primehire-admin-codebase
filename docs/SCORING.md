# keyword-v1 — deterministic resume/job scoring (Slice B)

> Versioned formula. `scoreVersion: "keyword-v1"` is stored on every
> `scoreBreakdown`. Changing the formula ships a new version, never a silent
> edit. LLM output (`match-score-v1`) is combined, never substituted.

## Inputs

- Candidate: `rawText` + structured `parsed` (`skills[]`, `languages[]`,
  `technologies[]`, `experienceYears`, `education[]`).
- Job: `mustHaveSkills[]`, `niceToHaveSkills[{skill, weight}]`,
  `minExperienceYears`, `maxExperienceYears`, `matchThreshold` (default 60).
- Skill hits use word-boundary matching with aliases
  (`services/resume_extract.py::skill_hit`): `Java` never matches
  `JavaScript`, `SQL` never matches `NoSQL`.

## Formula

```
coverage  = matchedMust / totalMust            (all-or-nothing per skill)
mustPts   = 80  * coverage                     (40 if the job lists no must-haves,
                                               so a blank resume scores 55 and pools)
nicePts   = 15  * matchedNiceWeight / totalNiceWeight   (15 if none listed)
expPts    = +5  in band ([min, max])
          | +3  above max
          | -10 below min
          |  0  experience unknown or no band configured
keyword   = clamp(round(mustPts + nicePts + expPts), 0, 100)
```

Maximum is exactly 100 (80 + 15 + 5); minimum exactly 0 (clamped).

## Knockout rule

Any must-have missing ⇒ `knockout: true`, `keyword = min(keyword, 40)`
(cap, not zero — the profile stays readable), `knockoutMissing[]` listed,
and the application gets `needsReview` with reason
`knockout: missing <skills>`.

## Combination with the LLM score

```
weights from org settings.scoring, default keyword 0.7 / llm 0.3 (normalized)
final = round(kw * keyword + lw * llm)   when the LLM answered and was trusted
final = keyword                          otherwise (LLM skipped/failed/injection)
disagreement = |keyword - llm|           (0 when the LLM was not used)
needsReview  = knockout
             | disagreement >= 25
             | injection suspected
             | low-confidence parse (legacy .doc)
             | possible duplicate / missing contact
```

Routing: `final >= threshold` → `SHORTLISTED`, else `TALENT_POOL`
(saved with reason `below_threshold`, flag `eligible`, `eligibleAfter`
+6 months). `needsReview` never blocks routing — a human triages from the
Applicants list; nothing is silently pooled.

## Worked example

Job must-haves `[Python, SQL]`, no nice-to-haves, threshold 60.
Candidate: Python + SQL, 6 years, no band configured.

```
coverage = 2/2 = 1.0  → mustPts = 80
nicePts  = 15 (none listed)
expPts   = 0 (no band)
keyword  = round(80 + 15 + 0) = 95 → SHORTLISTED
```
