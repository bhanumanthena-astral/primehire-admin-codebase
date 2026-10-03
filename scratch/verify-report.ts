/** Data-layer verification for the report redesign. Run: .\node_modules\.bin\tsx scratch\verify-report.ts */
import { readFileSync } from 'node:fs';
import { normalizeReport, generateInsights } from '../src/utils/normalizeReport';
import {
  getAggregates,
  getCoverage,
  getRadarPoints,
  getDistribution,
  deriveTopic,
} from '../src/utils/reportMetrics';
import { TECHNICAL_RADAR_AXES, COMM_RADAR_AXES } from '../src/utils/reportConfig';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}`, extra ?? '');
  }
}

const tech = JSON.parse(readFileSync('scratch/report-technical.json', 'utf8'));
const hr = JSON.parse(readFileSync('scratch/report-hr.json', 'utf8'));
const basic = JSON.parse(readFileSync('scratch/report-basic.json', 'utf8'));

// ── TECHNICAL (spec values: 44 / 55 / 51; comm 66/52/51/52) ──
const t = normalizeReport(tech)!;
check('tech: overall 44', t.overall.overallScore === 44, t.overall);
check('tech: comm 55', (t.overall.communication?.overall_score ?? t.overall.communication?.overallScore) === 55);
check('tech: confidence 51', t.overall.confidenceScore === 51);
check('tech: fluency 66', t.overall.communication?.fluency === 66);
check('tech: 8 questions', t.questions.length === 8);
check('tech: Q6 60/100 + 15% weight', (() => {
  const q6 = t.questions[5];
  return q6.percentage === 60 && q6.weightage === 15 && q6.obtainedScore === 60;
})());
check('tech: radar 7/7 non-null axes', getRadarPoints(t.overall, TECHNICAL_RADAR_AXES).length === 7);
check('tech: comm radar 5/5', getRadarPoints(t.overall, COMM_RADAR_AXES).length === 5);
const agg = getAggregates(t.questions);
check('tech: aggregates avg 40, high 60, low 20', agg.avg === 40 && agg.high === 60 && agg.low === 20, agg);
check('tech: weighted uses weightages', agg.weighted === 40, agg);
const cov = getCoverage(t.questions);
check('tech: coverage 8 evaluated, attempted unknown(null)', cov.evaluated === 8 && cov.attempted === null && cov.recordings === 8, cov);
check('tech: proctoring 3/3/0', (t.violations?.ideal_environment ?? t.violations?.idealEnvironment) === 3);
check('tech: topics inferred + labeled', t.questions.every((q) => deriveTopic(q.question).inferred === true));
check('tech: summary cites 44/100', (generateInsights(t).summary || '').includes('44/100'));
check('tech: distribution preserves order', getDistribution(t.questions).map((d) => d.percentage).join(',') === '40,30,20,60,30,60,20,60');

// ── HR (spec: 10 attempted, 0 evaluated, null blocks) ──
const h = normalizeReport(hr)!;
check('hr: round HR', h.meta.roundType === 'HR');
const hcov = getCoverage(h.questions);
check('hr: coverage 10/10/0', hcov.total === 10 && hcov.attempted === 10 && hcov.evaluated === 0 && hcov.pending === 10, hcov);
check('hr: 10 recordings', hcov.recordings === 10);
check('hr: radar has zero plottable axes', getRadarPoints(h.overall, TECHNICAL_RADAR_AXES).length === 0);
check('hr: overall blocks null in raw', (() => {
  const o = (hr.report?.overall_result ?? {}) as Record<string, unknown>;
  return o.personality_insights === null && o.hr_competency_analysis === null && o.vils_competency_analysis === null;
})());
check('hr: messages preserved, transcripts absent', h.questions.every((q) => !q.isGenerated && !!q.message && q.transcript === null));
check('hr: no fake scores (all null)', h.overall.overallScore === null && h.overall.confidenceScore === null);

// ── BASIC ──
const b = normalizeReport(basic)!;
check('basic: round BASIC', b.meta.roundType === 'BASIC');
check('basic: overall + comm mapped', b.overall.overallScore === 71 && (b.overall.communication?.overall_score ?? b.overall.communication?.overallScore) === 74);
check('basic: comm radar 5/5', getRadarPoints(b.overall, COMM_RADAR_AXES).length === 5);

// ── Null-safety ──
check('null input -> null', normalizeReport(null) === null);
const empty = normalizeReport({} as any)!;
check('empty object never throws, UNKNOWN round', empty.meta.roundType === 'UNKNOWN' && empty.questions.length === 0);
check('empty radar -> [] (never zeros)', getRadarPoints(empty.overall, TECHNICAL_RADAR_AXES).length === 0);

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nAll report data checks passed.');
