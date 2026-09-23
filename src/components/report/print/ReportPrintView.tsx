import type { CSSProperties } from 'react';
import { getGrade, shortId, formatDate } from '../../../utils/normalizeReport';
import type { NormalizedReport, Insights } from '../../../utils/normalizeReport';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis as RA,
  PolarRadiusAxis,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
} from 'recharts';

// White-theme print/PDF version. All tab sections render stacked in one
// column (a static PDF can't capture tab-switching). Video can't be embedded
// as playable media — instead each row links to its real video_url.
export default function ReportPrintView({
  report,
  insights,
}: {
  report: NormalizedReport | null;
  insights: Insights;
}) {
  if (!report) return null;
  const { meta, overall, questions, violations } = report;
  const grade = getGrade(overall.overallScore);

  // Built ONLY from real fields.
  const radarData = [
    { metric: 'Technical', value: overall.overallScore ?? 0 },
    { metric: 'Confidence', value: overall.confidenceScore ?? 0 },
    { metric: 'Fluency', value: overall.communication?.fluency ?? 0 },
    { metric: 'Grammar', value: overall.communication?.grammar ?? 0 },
    { metric: 'Vocabulary', value: overall.communication?.vocabulary ?? 0 },
  ];

  const distData = [
    { name: 'Technical', value: overall.overallScore ?? 0 },
    { name: 'Communication', value: overall.communication?.overall_score ?? overall.communication?.overallScore ?? 0 },
    { name: 'Presence', value: overall.confidenceScore ?? 0 },
  ];

  return (
    <div style={{ width: 794, background: '#ffffff', color: '#0f172a', fontFamily: 'Arial, sans-serif', padding: 36 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          borderBottom: '2px solid #4f46e5',
          paddingBottom: 14,
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Interview Performance Report</h1>
          <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
            Candidate #{shortId(meta.candidateId, 10)} · {meta.roundType} Round
          </p>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10, color: '#64748b' }}>
          <p style={{ margin: 0 }}>Job ID: {shortId(meta.jobId, 14)}</p>
          <p style={{ margin: 0 }}>Submitted: {formatDate(meta.submittedAt)}</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <Box label="Overall Score" value={overall.overallScore} color={grade.color} />
        {overall.communication && (
          <Box
            label="Communication"
            value={overall.communication.overall_score ?? overall.communication.overallScore}
            color="#0891b2"
          />
        )}
        {overall.confidenceScore !== null && <Box label="Confidence" value={overall.confidenceScore} color="#9333ea" />}
        <Box label="Questions" value={questions.length} color="#7c3aed" />
      </div>

      <p style={{ fontSize: 12, background: '#f8fafc', padding: 12, borderRadius: 8, fontStyle: 'italic', marginBottom: 20 }}>
        &ldquo;{insights.summary}&rdquo;
      </p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20, breakInside: 'avoid' }}>
        <div style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Skill Profile</p>
          <RadarChart width={340} height={200} data={radarData} outerRadius="75%">
            <PolarGrid stroke="#e2e8f0" />
            <RA dataKey="metric" tick={{ fill: '#475569', fontSize: 9 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
            <Radar dataKey="value" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.3} strokeWidth={2} />
          </RadarChart>
        </div>
        <div style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Score Distribution</p>
          <BarChart width={340} height={200} data={distData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9 }} />
            <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 9 }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {distData.map((d, i) => (
                <Cell key={i} fill={getGrade(d.value).color} />
              ))}
            </Bar>
          </BarChart>
        </div>
      </div>

      {violations && (
        <div style={{ marginBottom: 20, border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, breakInside: 'avoid' }}>
          <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Proctoring Summary</p>
          <div style={{ display: 'flex', gap: 20 }}>
            {Object.entries(violations).map(([k, v]) => (
              <span key={k} style={{ fontSize: 10 }}>
                {(k as string).replace(/_/g, ' ')}:{' '}
                <b style={{ color: (v as number) > 0 ? '#dc2626' : '#16a34a' }}>{String(v)}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Question-wise Breakdown</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginBottom: 20 }}>
        <thead>
          <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
            <th style={cell}>#</th>
            <th style={cell}>Question</th>
            <th style={cell}>Score</th>
            <th style={cell}>Grade</th>
            <th style={cell}>Recording</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q) => {
            const g = getGrade(q.percentage);
            return (
              <tr key={q.key} style={{ borderBottom: '1px solid #e2e8f0', breakInside: 'avoid' }}>
                <td style={cell}>{q.index}</td>
                <td style={{ ...cell, maxWidth: 260 }}>{q.question}</td>
                <td style={cell}>{q.isGenerated ? `${q.obtainedScore}/${q.maxScore}` : 'N/A'}</td>
                <td style={cell}>
                  <span style={{ color: g.color, fontWeight: 700 }}>{g.letter}</span>
                </td>
                <td style={cell}>
                  {q.videoUrl ? (
                    <a href={q.videoUrl} style={{ color: '#4f46e5' }}>
                      ▶ Watch Recording
                    </a>
                  ) : (
                    'N/A'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 12, breakInside: 'avoid' }}>
        <InsightCol title="Strengths" items={insights.strengths} color="#16a34a" />
        <InsightCol title="Areas for Improvement" items={insights.improvements} color="#dc2626" />
        <InsightCol title="Recommendations" items={insights.recommendations} color="#2563eb" />
      </div>

      <div
        style={{
          marginTop: 24,
          paddingTop: 10,
          borderTop: '1px solid #e2e8f0',
          fontSize: 9,
          color: '#94a3b8',
          textAlign: 'center',
        }}
      >
        Generated on {new Date().toLocaleString()} — Confidential Report
      </div>
    </div>
  );
}

function Box({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  return (
    <div style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
      <p style={{ fontSize: 9, color: '#64748b', margin: 0, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, margin: '2px 0 0', color }}>{value ?? '—'}</p>
    </div>
  );
}

function InsightCol({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
      <p style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color }}>{title}</p>
      <ul style={{ margin: 0, paddingLeft: 14, fontSize: 9.5, color: '#475569' }}>
        {items.map((it, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

const cell: CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
