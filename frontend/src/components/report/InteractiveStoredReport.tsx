import type {ReportContent, ReportMetadata} from '../../lib/reportingApi';
import {normalizeStoredReport} from '../../utils/storedReport';
import RoundReport from './RoundReport';
import {StoredReportEvidence,ReportVideoProvider} from './StoredReportEvidence';

export {storedPercentage} from '../../utils/storedReport';

export function InteractiveStoredReport({content,metadata}:{content:ReportContent;metadata:ReportMetadata}) {
  if (!content.schemaSupported) return <StoredReportEvidence content={content} reportId={metadata.reportId} version={metadata.version}/>;
  const report = normalizeStoredReport(content, metadata);
  return <ReportVideoProvider key={`${metadata.reportId}:${metadata.version}`}><RoundReport report={report}
    insights={{summary:'',strengths:[],improvements:[],recommendations:[]}} stored={{content,metadata}}/></ReportVideoProvider>;
}
