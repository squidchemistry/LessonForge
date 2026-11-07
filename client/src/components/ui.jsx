import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const Badge = ({ s, children }) => <span className={`badge ${s}`}>{children ?? String(s).replace('_', ' ')}</span>;

/** Markdown with [S3] citation markers turned into links to the reference list. */
export function Md({ text }) {
  const t = String(text || '').replace(/\[(S\d+)\]/g, (_, id) => `[[${id.slice(1)}]](#ref-${id})`);
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{t}</ReactMarkdown>;
}

export const totalMinutes = (lesson) => lesson.sections.reduce((a, s) => a + (Number(s.minutes) || 0), 0);

export const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');
