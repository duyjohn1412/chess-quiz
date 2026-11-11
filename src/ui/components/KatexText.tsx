import React from 'react';
import katex from 'katex';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br />');
}

function renderMixedMath(input: string): string {
  // Hỗ trợ $$...$$ và $...$
  const parts: string[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === '$') {
      const isDisplay = input[i + 1] === '$';
      const delim = isDisplay ? '$$' : '$';
      const start = i + delim.length;
      const end = input.indexOf(delim, start);
      if (end !== -1) {
        const tex = input.slice(start, end);
        try {
          parts.push(
            katex.renderToString(tex, {
              displayMode: isDisplay,
              throwOnError: false,
              strict: false,
            })
          );
          i = end + delim.length;
          continue;
        } catch {
          // fallback plain
        }
      }
    }
    const nextDollar = input.indexOf('$', i + 1);
    const chunk = nextDollar === -1 ? input.slice(i) : input.slice(i, nextDollar);
    parts.push(escapeHtml(chunk));
    i += chunk.length;
  }
  return parts.join('');
}

export const KatexText: React.FC<{ text: string; className?: string }> = ({
  text,
  className,
}) => {
  const html = React.useMemo(() => renderMixedMath(text), [text]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};
