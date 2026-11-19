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

## Module 2 (`module2-v2`) � resume intake ATS

The V2 intake pipeline stores its own `scoreVersion: "module2-v2"` and
`taxonomyVersion: "skills-v2"` in the ATS payload; `keyword-v1` above remains
unchanged for the legacy pipeline. The V2 formula is deliberately
requirement-first and explainable:

```
mandatory = mustHaveSkills when present, otherwise keywords
preferred = niceToHaveSkills + keywords not already mandatory
skills    = 100 * mandatory credit / mandatory requirements
keyword   = 100 * matched preferred weight / total preferred weight
overall   = weighted mean of available dimensions, renormalized
            (skills 35, experience 20, education 10, keyword 15, role 20)
```

- A requirement is matched through canonical aliases (`React.js` = `React`,
  `NodeJS` = `Node.js`) against the **reviewed candidate profile**. Resume
  evidence is used for explanation and excerpts, never to override a human
  adding or removing a skill.
- A multi-part requirement earns `0.5` credit per known evidenced component
  (for example `AWS EC2` when the profile has `AWS`). Partial matches are
  returned in `partialMatches`; they are not reported as fully matched.
- `matchedPreferredSkills` and `missingPreferredSkills` are separate from the
  mandatory lists. The five existing breakdown keys are preserved so the table
  and confirmation range logic do not need a schema migration.
- `unassessed` lists dimensions with no job/profile input; unavailable
  dimensions are excluded rather than assumed. Education keywords are matched
  with negation-aware aliases, and personal attributes are never scored.
- The ATS payload is advisory: it never changes a stage, sends email or makes a
  hiring decision. Reviewer-visible evidence excerpts are contact-redacted
  unless the audited reveal path is used.
- `POST /api/resume-intake/items/{itemId}/reparse` reprocesses the stored
  original, replaces resume-derived skills/evidence, retains reviewed personal
  fields, clears the old ATS and recalculates it for a confirmed application.
  The action is audited as `resume_intake.reparse`.

New extraction versions: `resume-parser-v2` / `skills-v2`. Parser evidence is
returned in `ParsedResume.skillEvidence` and `CandidateProfile.skillEvidence`.
