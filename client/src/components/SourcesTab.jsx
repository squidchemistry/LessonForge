import React from 'react';
import { Badge, when } from './ui.jsx';

const ICON = { web: '🌐', video: '▶️', book: '📚' };

export default function SourcesTab({ rec }) {
  const r = rec.research;
  if (!r) return <div className="card">No research yet. Click <b>Run</b> on the Research step above.</div>;
  const used = new Set((rec.lesson?.references || []).map((x) => x.id));
  return (
    <div>
      <div className="notice">Researched {when(r.at)} · {r.sources.length} sources. The lesson may only cite what is listed here, so links are never invented.</div>
      {r.warnings.map((w, i) => <div key={i} className="notice bad">{w}</div>)}
      {r.sources.map((s) => (
        <div className="src" key={s.id}>
          <div className="meta">
            <b>{s.id}</b><span>{ICON[s.type]} {s.type}</span><span className="mono muted">{s.domain}</span>
            {s.type === 'video' && <Badge s={s.hasTranscript ? 'ok' : 'low'}>{s.hasTranscript ? 'transcript read' : 'no transcript'}</Badge>}
            {rec.lesson && <Badge s={used.has(s.id) ? 'done' : 'idle'}>{used.has(s.id) ? 'cited' : 'not cited'}</Badge>}
          </div>
          <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
          <div className="ex">{s.excerpt}</div>
        </div>
      ))}
    </div>
  );
}
