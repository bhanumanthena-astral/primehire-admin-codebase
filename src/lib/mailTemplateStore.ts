import type { MailTemplate } from '../types';
import { createTemplate, deleteTemplate, fetchTemplates, updateTemplate } from './mongoApi';

/** Browser caches are read-only fallbacks; only explicit saves may write templates. */
export function createMailTemplateStore(initial: MailTemplate[], onChange: (templates: MailTemplate[]) => void) {
  let templates = initial;
  let revision = 0;
  let latestLoad = 0;
  let pendingWrites = 0;
  let writes: Promise<unknown> = Promise.resolve();

  const publish = (next: MailTemplate[]) => {
    templates = next;
    onChange(next);
  };

  function write<T>(operation: () => Promise<T>): Promise<T> {
    revision++;
    pendingWrites++;
    const result = writes.then(operation).finally(() => {
      revision++;
      pendingWrites--;
    });
    writes = result.catch(() => {});
    return result;
  }

  return {
    async load(): Promise<void> {
      if (pendingWrites) return;
      const request = ++latestLoad;
      const startedAt = revision;
      const server = await fetchTemplates();
      if (request === latestLoad && startedAt === revision && !pendingWrites) {
        publish(server); // An empty server list must also replace a stale cache.
      }
    },
    save(template: MailTemplate, isNew: boolean): Promise<void> {
      return write(async () => {
        const saved = isNew
          ? await createTemplate(template)
          : await updateTemplate(template.id, template);
        publish(templates.some(t => t.id === saved.id)
          ? templates.map(t => t.id === saved.id ? saved : t)
          : [...templates, saved]);
      });
    },
    remove(id: string): Promise<void> {
      return write(async () => {
        try {
          await deleteTemplate(id);
        } catch (error: any) {
          if (error?.status !== 404) throw error; // Another user already removed it.
        }
        publish(templates.filter(t => t.id !== id));
      });
    },
  };
}
