import {Button} from '@/components/ui/button';
import { useState } from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';

const PREVIEW_CHARS = 420;

/** Readable transcript with copy + progressive disclosure. */
export default function TranscriptPanel({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!text) {
    return <p className="text-sm italic text-muted-foreground">Transcript unavailable.</p>;
  }
  const long = text.length > PREVIEW_CHARS;
  const shown = expanded || !long ? text : `${text.slice(0, PREVIEW_CHARS)}…`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-2">
        <Button variant="ghost"
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </Button>
        {long && (
          <Button variant="ghost"
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent"
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : 'Show more'}
            <ChevronDown size={12} className={expanded ? 'rotate-180' : ''} />
          </Button>
        )}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{shown}</p>
    </div>
  );
}
