/**
 * Renderer de markdown light: bold, italic, listas, links, code inline,
 * line breaks. NÃO usa biblioteca externa pra manter o bundle leve — o
 * Copiloto produz markdown simples e previsível.
 */

import { Fragment } from 'react';

interface MarkdownProps {
  text: string;
}

export function Markdown({ text }: MarkdownProps) {
  const blocks = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks.map((block, i) => (
        <Fragment key={i}>{renderBlock(block)}</Fragment>
      ))}
    </div>
  );
}

function renderBlock(block: string): React.ReactNode {
  // Listas (- ou *) — agrupa linhas consecutivas com marcador
  const lines = block.split('\n');
  const isList = lines.every((l) => /^[-*]\s+/.test(l) || l.trim() === '');
  if (isList && lines.some((l) => /^[-*]\s+/.test(l))) {
    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {lines
          .filter((l) => /^[-*]\s+/.test(l))
          .map((l, i) => (
            <li key={i}>{renderInline(l.replace(/^[-*]\s+/, ''))}</li>
          ))}
      </ul>
    );
  }

  // Cabeçalho `**texto**` standalone
  if (/^\*\*.+\*\*$/.test(block)) {
    return <p className="font-semibold">{renderInline(block.slice(2, -2))}</p>;
  }

  // Parágrafo com line breaks internos
  return (
    <p>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {renderInline(l)}
          {i < lines.length - 1 && <br />}
        </Fragment>
      ))}
    </p>
  );
}

function renderInline(text: string): React.ReactNode {
  // Tokenize: **bold**, *italic*, `code`, [text](url)
  const tokens: React.ReactNode[] = [];
  let cursor = 0;
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text))) {
    if (match.index > cursor) {
      tokens.push(text.slice(cursor, match.index));
    }
    const m = match[0];
    if (m.startsWith('**')) {
      tokens.push(
        <strong key={key++} className="font-semibold">
          {m.slice(2, -2)}
        </strong>,
      );
    } else if (m.startsWith('`')) {
      tokens.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">
          {m.slice(1, -1)}
        </code>,
      );
    } else if (m.startsWith('[')) {
      const lm = m.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        tokens.push(
          <a
            key={key++}
            href={lm[2]}
            className="text-primary underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {lm[1]}
          </a>,
        );
      } else {
        tokens.push(m);
      }
    } else if (m.startsWith('*')) {
      tokens.push(
        <em key={key++} className="italic">
          {m.slice(1, -1)}
        </em>,
      );
    } else {
      tokens.push(m);
    }
    cursor = match.index + m.length;
  }

  if (cursor < text.length) {
    tokens.push(text.slice(cursor));
  }

  return <>{tokens}</>;
}
