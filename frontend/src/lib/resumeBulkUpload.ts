import {intakeUpload, type IntakeBatch} from './resumeIntakeApi';

/** Bounded requests with stable idempotency keys across retries of a selection. */
export async function uploadResumeSelection(options: {
  jobId: string; mode: string; source: string; files: File[]; companion: File | null;
  key: string; signal: AbortSignal; chunkSize: number;
  onAccepted: (batch: IntakeBatch, received: number, total: number) => void;
}) {
  const {files, mode, signal} = options;
  if (!files.length || files.length > (mode === 'files' ? 1000 : 1)) {
    throw new Error('Select up to 1,000 resumes, or one archive or spreadsheet.');
  }
  const chunkSize = mode === 'files' ? Math.max(1, Math.min(10, options.chunkSize)) : 1;
  let last: IntakeBatch | undefined;
  for (let offset = 0; offset < files.length; offset += chunkSize) {
    signal.throwIfAborted();
    const chunk = files.slice(offset, offset + chunkSize);
    last = await intakeUpload(options.jobId, mode, options.source, chunk,
      options.companion, `${options.key}-${offset}`, signal);
    options.onAccepted(last, Math.min(files.length, offset + chunk.length), files.length);
  }
  return last!;
}
