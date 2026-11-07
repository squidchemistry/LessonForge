import React from 'react';
import { Badge } from './ui.jsx';

const ICON = { research: '🔎', generate: '✍️', qc1: '🧪', qc2: '🎓' };

export default function Pipeline({ rec, busy, onRun, labels }) {
  const ready = {
    research: true,
    generate: rec.steps.research.status === 'done' && !!rec.research,
    qc1: !!rec.lesson && !!rec.research,
    qc2: !!rec.lesson,
  };
  const anyBusy = Object.values(busy).some(Boolean);
  return (
    <div className="pipeline no-print">
      {['research', 'generate', 'qc1', 'qc2'].map((k) => {
        const st = rec.steps[k];
        const status = busy[k] ? 'running' : st.status;
        const label = status === 'failed' ? '↻ Retry' : status === 'done' ? '↻ Re-run' : '▶ Run';
        return (
          <div key={k} className={`step ${status}`}>
            <div className="row between"><span className="n">{ICON[k]} {labels[k]}</span><Badge s={status} /></div>
            {status === 'failed' && st.error && <div className="err">{st.error}</div>}
            {status === 'done' && st.note && <div className="err">{st.note}</div>}
            {status === 'running' && <div className="muted">Working… this can take 1-3 minutes.</div>}
            <button className={`btn small ${status === 'failed' ? 'red' : 'yellow'}`} disabled={!ready[k] || anyBusy || status === 'running'} onClick={() => onRun(k)} title={!ready[k] ? 'Complete the previous step first' : ''}>{label}</button>
          </div>
        );
      })}
    </div>
  );
}
