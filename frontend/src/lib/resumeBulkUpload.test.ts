import {beforeEach, describe, expect, it, vi} from 'vitest';
import {intakeUpload} from './resumeIntakeApi';
import {uploadResumeSelection} from './resumeBulkUpload';

vi.mock('./resumeIntakeApi', () => ({intakeUpload: vi.fn()}));
const files = Array.from({length: 1000}, (_, i) => new File(['resume'], `${i}.pdf`));
const options = () => ({jobId: 'job', mode: 'files', source: 'local', files,
  companion: null, key: 'selection', signal: new AbortController().signal,
  chunkSize: 10, onAccepted: vi.fn()});

describe('bounded resume uploads', () => {
  beforeEach(() => { vi.mocked(intakeUpload).mockReset(); });
  it('sends 1000 files in sequential requests of at most ten', async () => {
    let active = 0;
    vi.mocked(intakeUpload).mockImplementation(async (...args) => {
      expect(++active).toBe(1);
      expect(args[3]).toHaveLength(10);
      await Promise.resolve();
      active--;
      return {batchId: args[5]} as any;
    });
    const input = options();
    await uploadResumeSelection(input);
    expect(intakeUpload).toHaveBeenCalledTimes(100);
    expect(input.onAccepted).toHaveBeenLastCalledWith({batchId: 'selection-990'}, 1000, 1000);
  });
  it('preserves idempotency keys on a retry after partial success', async () => {
    vi.mocked(intakeUpload).mockResolvedValueOnce({batchId: 'accepted'} as any)
      .mockRejectedValueOnce(new Error('capacity paused'));
    const input = {...options(), files: files.slice(0, 25)};
    await expect(uploadResumeSelection(input)).rejects.toThrow('capacity paused');
    expect(input.onAccepted).toHaveBeenCalledTimes(1);
    vi.mocked(intakeUpload).mockResolvedValue({batchId: 'accepted'} as any);
    await uploadResumeSelection(input);
    expect(vi.mocked(intakeUpload).mock.calls.map(call => call[5]))
      .toEqual(['selection-0', 'selection-10', 'selection-0', 'selection-10', 'selection-20']);
  });
  it('stops before sending when cancelled and rejects oversized selections', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadResumeSelection({...options(), signal: controller.signal})).rejects.toThrow();
    await expect(uploadResumeSelection({...options(), files: [...files, files[0]]})).rejects.toThrow('1,000');
    expect(intakeUpload).not.toHaveBeenCalled();
  });
});
