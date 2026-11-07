import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Badge, totalMinutes, when } from './ui.jsx';

const KINDS = ['hook', 'concept', 'example', 'activity', 'check', 'wrap'];
const COLORS = { hook: '#ff6b9d', concept: '#6fb1ff', example: '#b794f6', activity: '#6bcb77', check: '#ffd93d', wrap: '#ffa94d' };

export default function EditorTab({ rec, setDirty, onSaved, onError, onRestore, onRun, busy }) {
  const [draft, setDraft] = useState(() => structuredClone(rec.lesson));
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(rec.lesson), [draft, rec.lesson]);

  useEffect(() => { setDirty(dirty); }, [dirty, setDirty]);
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (!draft) {
    return <div className="card">No lesson yet. Run <b>Research</b>, then <b>Generate lesson</b>.{rec.steps.generate.status === 'failed' && <div className="notice bad" style={{ marginTop: 10 }}>Last attempt failed: {rec.steps.generate.error}</div>}</div>;
  }

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setSec = (i, patch) => set({ sections: draft.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setQ = (i, patch) => set({ quiz: draft.quiz.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const total = totalMinutes(draft);
  const move = (i, d) => { const a = [...draft.sections]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; set({ sections: a }); };

  async function save() {
    if (!draft.title.trim()) return onError('Title cannot be empty.');
    if (draft.sections.some((s) => !s.heading.trim())) return onError('Every section needs a heading.');
    setSaving(true);
    try { onSaved(await api.save(rec.id, draft, label || 'Instructor edit')); setLabel(''); } catch (e) { onError(e.message); } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="card no-print">
        <div className="row between">
          <div className="row">
            <b>Total time:</b><Badge s={total === 45 ? 'done' : 'failed'}>{total} / 45 min</Badge>
            {dirty && <Badge s="running">unsaved changes</Badge>}
            <span className="muted">v{rec.version} · {rec.versions.at(-1)?.label}</span>
          </div>
          <div className="row">
            <input style={{ width: 200 }} placeholder="version note (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <button className="btn small" disabled={!dirty} onClick={() => setDraft(structuredClone(rec.lesson))}>Discard</button>
            <button className="btn green" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : '💾 Save version'}</button>
          </div>
        </div>
        <div className="timebar" title="Minutes per section">
          {draft.sections.map((s) => <div key={s.id} style={{ width: `${(s.minutes / Math.max(total, 1)) * 100}%`, background: COLORS[s.kind] }}>{s.minutes}</div>)}
        </div>
        {(rec.qc1 || rec.qc2) && dirty && <div className="notice">You have unsaved edits. Save before applying QC recommendations.</div>}
      </div>

      <div className="card">
        <label>Title</label><input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
        <label>Summary</label><textarea value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
        <label>Learning outcomes (one per line)</label>
        <textarea value={draft.learningOutcomes.join('\n')} onChange={(e) => set({ learningOutcomes: e.target.value.split('\n') })} onBlur={() => set({ learningOutcomes: draft.learningOutcomes.map((x) => x.trim()).filter(Boolean) })} />
      </div>

      <h2>Sections</h2>
      {draft.sections.map((s, i) => (
        <div className="section-edit" key={s.id} style={{ borderLeft: `14px solid ${COLORS[s.kind]}` }}>
          <div className="row">
            <input className="grow" value={s.heading} onChange={(e) => setSec(i, { heading: e.target.value })} aria-label="heading" />
            <select style={{ width: 130 }} value={s.kind} onChange={(e) => setSec(i, { kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <input className="minutes" type="number" min="0" max="60" value={s.minutes} onChange={(e) => setSec(i, { minutes: e.target.value === '' ? 0 : Number(e.target.value) })} aria-label="minutes" /><span>min</span>
            <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button className="btn small" onClick={() => move(i, 1)} disabled={i === draft.sections.length - 1}>↓</button>
            <button className="btn small red" onClick={() => { if (window.confirm(`Remove section "${s.heading}"?`)) set({ sections: draft.sections.filter((_, j) => j !== i) }); }}>✕</button>
          </div>
          <label>Content (markdown; cite sources like [S2])</label>
          <textarea className="big" value={s.content} onChange={(e) => setSec(i, { content: e.target.value })} />
        </div>
      ))}
      <button className="btn" onClick={() => set({ sections: [...draft.sections, { id: `sec-${Date.now().toString(36)}`, heading: 'New section', kind: 'concept', minutes: 0, content: '' }] })}>+ Add section</button>

      <h2 style={{ marginTop: 28 }}>Knowledge check</h2>
      {draft.quiz.map((q, i) => (
        <div className="section-edit" key={q.id}>
          <div className="row"><b>Q{i + 1}</b><input className="grow" value={q.question} onChange={(e) => setQ(i, { question: e.target.value })} />
            <button className="btn small red" onClick={() => set({ quiz: draft.quiz.filter((_, j) => j !== i) })}>✕</button></div>
          {q.options.map((o, j) => (
            <div className="row" key={j} style={{ marginTop: 6 }}>
              <input type="radio" style={{ width: 20 }} name={`ans-${q.id}`} checked={q.answerIndex === j} onChange={() => setQ(i, { answerIndex: j })} title="correct answer" />
              <b>{'ABCD'[j]}</b>
              <input className="grow" value={o} onChange={(e) => setQ(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })} />
            </div>
          ))}
          <label>Explanation</label><textarea style={{ minHeight: 50 }} value={q.explanation} onChange={(e) => setQ(i, { explanation: e.target.value })} />
        </div>
      ))}
      <button className="btn" onClick={() => set({ quiz: [...draft.quiz, { id: `q${Date.now().toString(36)}`, question: '', options: ['', '', '', ''], answerIndex: 0, explanation: '' }] })}>+ Add question</button>

      <h2 style={{ marginTop: 28 }}>Supplementary videos</h2>
      {!draft.videos.length && <div className="muted">No videos selected.</div>}
      {draft.videos.map((v, i) => (
        <div className="section-edit" key={v.sourceId}>
          <div className="row between"><a href={v.url} target="_blank" rel="noreferrer">▶ {v.title}</a><button className="btn small red" onClick={() => set({ videos: draft.videos.filter((_, j) => j !== i) })}>✕</button></div>
          <label>Why watch</label><input value={v.why} onChange={(e) => set({ videos: draft.videos.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)) })} />
        </div>
      ))}
      <div className="muted">References are rebuilt automatically from the sources cited in the lesson when you save.</div>

      <h2 style={{ marginTop: 28 }}>Version history</h2>
      <div className="card flat">
        {[...rec.versions].reverse().map((v) => (
          <div className="row between" key={v.v} style={{ padding: '4px 0', borderBottom: '2px dashed #0003' }}>
            <span><b>v{v.v}</b> · {v.label} · <span className="muted">{when(v.at)}</span>{v.v === rec.version && <> <Badge s="done">current</Badge></>}</span>
            {v.v !== rec.version && <button className="btn small" disabled={dirty} onClick={() => onRestore(v.v)}>Restore as new version</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
