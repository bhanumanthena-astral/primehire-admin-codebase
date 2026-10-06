import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { cn } from '@/lib/utils';

export const JD_MIN_CHARS = 50;
export const JD_MAX_CHARS = 10000;

export function jdPlainText(html: string): string {
  if (typeof window === 'undefined') return '';
  const el = document.createElement('div');
  el.innerHTML = html || '';
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function ToolButton({
  label, title, active, onClick, disabled,
}: {
  label: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'min-w-8 cursor-pointer rounded-md border px-1.5 py-1 text-[12px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-[var(--ring)] bg-[var(--primary-soft)] text-foreground'
          : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}

/**
 * Rich-text JD editor (PRD §8): headings, bold/italic, bullets, ordered
 * lists, quotes, links, special characters via full Unicode support.
 */
export function JdEditor({
  value, onChange, describedBy,
}: {
  value: string;
  onChange: (html: string) => void;
  describedBy?: string;
}) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2] },
          // StarterKit bundles Link; keep clicks inside the editor.
          link: { openOnClick: false, autolink: true },
        }),
      ],
      content: value || '<p></p>',
      onUpdate: ({ editor: e }) => onChange(e.getHTML()),
      editorProps: {
        attributes: {
          class: 'ehr-richtext',
          'aria-label': 'Job description',
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        },
      },
    },
    []
  );

  // External fills (JD-upload mapping) while the user is not typing.
  const lastExternal = useRef(value);
  useEffect(() => {
    lastExternal.current = value;
    if (editor && !editor.isFocused && value !== editor.getHTML()) {
      editor.commands.setContent(value || '<p></p>');
    }
  }, [value, editor]);

  if (!editor) {
    return <div className="ehr-input min-h-[180px] animate-pulse" aria-label="Loading editor" />;
  }

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previous || 'https://');
    if (url === null) return;
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  const plainLen = (editor.state.doc.textContent || '').replace(/\s+/g, ' ').trim().length;

  return (
    <div>
      <div
        role="toolbar"
        aria-label="Formatting"
        className="mb-1.5 flex flex-wrap items-center gap-1 rounded-[10px] border border-border bg-card p-1.5"
      >
        <ToolButton label="H1" title="Heading 1" active={editor.isActive('heading', { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <ToolButton label="H2" title="Heading 2" active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolButton label={<strong>B</strong>} title="Bold" active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolButton label={<em>I</em>} title="Italic" active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolButton label="• List" title="Bullet list" active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolButton label="1. List" title="Ordered list" active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolButton label="❝" title="Quote" active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <ToolButton label="🔗" title="Link" active={editor.isActive('link')} onClick={setLink} />
        <ToolButton label="✕" title="Clear formatting"
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} />
      </div>
      <div className="ehr-input focus-within:border-[var(--ring)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_22%,transparent)]">
        <EditorContent editor={editor} />
      </div>
      <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
        {plainLen} / {JD_MIN_CHARS}–{JD_MAX_CHARS} characters
      </div>
    </div>
  );
}
