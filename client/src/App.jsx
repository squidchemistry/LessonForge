import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Pipeline from './components/Pipeline.jsx';
import SourcesTab from './components/SourcesTab.jsx';
import EditorTab from './components/EditorTab.jsx';
import QCTab from './components/QCTab.jsx';
import PreviewTab from './components/PreviewTab.jsx';
import ExportTab from './components/ExportTab.jsx';
import { Badge } from './components/ui.jsx';

const STEP_LABEL = { research: 'Research', generate: 'Generate lesson', qc1: 'QC 1 - Facts', qc2: 'QC 2 - Instruction' };

export default function App() {
  const [lessons, setLessons] = useState([]);
  const [sel, setSel] = useState(null);
  const [rec, setRec] = useState(null);
  const [tab, setTab] = useState('lesson');
  const [busy, setBusy] = useState({});
  const [toast, setToast] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState({ title: '', objective: '' });
  const [creating, setCreating] = useState(false);
  const [health, setHealth] = useState(null);
  const selRef = useRef(null);
  selRef.current = sel;

  const say = (msg, ok = false) => setToast({ msg, ok });
  const refreshList = useCallback(() => api.list().then(setLessons).catch(() => {}), []);

  useEffect(() => {
    refreshList();
    api.health().then(setHealth).catch(() => setHealth({ ok: false }));
  }, [refreshList]);

  const load = useCallback(async (id) => {
    try { setRec(await api.get(id)); } catch (e) { say(e.message); }
  }, []);

  useEffect(() => {
    if (sel) { setDirty(false); load(sel); } else setRec(null);
  }, [sel, load]);

  // Poll while the server reports a running step we aren't awaiting ourselves (e.g. after a page reload).
  const serverRunning = rec && Object.values(rec.steps).some((s) => s.status === 'running');
  const anyBusy = Object.values(busy).some(Boolean);
  useEffect(() => {
    if (!serverRunning || anyBusy) return undefined;
    const t = setInterval(() => load(selRef.current), 3000);
    return () => clearInterval(t);
  }, [serverRunning, anyBusy, load]);

  async function createLesson(e) {
    e.preventDefault();
    if (!form.title.trim()) return say('Please enter a lesson title.');
    if (!form.objective.trim()) return say('Please enter a learning objective.');
    setCreating(true);
    try {
      const r = await api.create(form);
      setForm({ title: '', objective: '' });
      await refreshList();
      setSel(r.id);
      setTab('sources');
    } catch (err) { say(err.message); } finally { setCreating(false); }
  }

  async function run(step) {
    if (!rec) return false;
    if (step === 'generate' && rec.lesson && !window.confirm('Regenerate the lesson? Your current lesson stays in version history, but QC reports will be cleared.')) return false;
    const id = rec.id;
    setBusy((b) => ({ ...b, [step]: true }));
    setRec((r) => (r ? { ...r, steps: { ...r.steps, [step]: { ...r.steps[step], status: 'running', error: null } } } : r));
    try {
      await api.runStep(id, step); // returns immediately (202); the server works in the background
      // Poll until the step leaves "running". Tolerate a few transient network errors (e.g. a host waking up).
      let out;
      for (let misses = 0; ;) {
        await new Promise((r) => setTimeout(r, 2500));
        try { out = await api.get(id); misses = 0; } catch (err) { if (++misses >= 6) throw err; continue; }
        if (selRef.current === id) setRec(out);
        if (out.steps[step].status !== 'running') break;
      }
      if (out.steps[step].status === 'failed') throw new Error(out.steps[step].error || 'unknown error');
      if (selRef.current === id && step === 'generate') { setDirty(false); setTab('lesson'); }
      if (step === 'research' && out.steps.research.note) say(`Research finished with notes: ${out.steps.research.note}`, true);
      refreshList();
      return true;
    } catch (e) {
      say(`${STEP_LABEL[step]} failed: ${e.message}`);
      if (selRef.current === id) await load(id); // pulls the persisted failed status; saved work is untouched
      return false;
    } finally {
      setBusy((b) => ({ ...b, [step]: false }));
    }
  }

  async function runAll() {
    for (const s of ['research', 'generate', 'qc1', 'qc2']) {
      // skip research when it is already done to save API quota; generate asks before overwriting
      if (s === 'research' && rec.steps.research.status === 'done' && rec.research) continue;
      if (!(await run(s))) break;
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this lesson and all its versions?')) return;
    try { await api.remove(id); if (sel === id) setSel(null); refreshList(); } catch (e) { say(e.message); }
  }

  const tabs = [['sources', 'Research'], ['lesson', 'Lesson & Edit'], ['qc1', 'QC 1 · Facts'], ['qc2', 'QC 2 · Instruction'], ['preview', 'Preview'], ['export', 'Export']];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">LessonForge</div>
        <div className="tag">Research → Generate → Audit ×2 → Export</div>
        {health && !health.ok && <div className="notice bad">Server not reachable. Run <code>npm run dev</code>.</div>}
        {health?.ok && Object.entries(health.keys).some(([, v]) => !v) && <div className="notice bad">Missing API keys in server/.env: {Object.entries(health.keys).filter(([, v]) => !v).map(([k]) => k).join(', ')}</div>}
        <form className="card" onSubmit={createLesson} noValidate>
          <h3>New lesson</h3>
          <label htmlFor="t">Lesson title</label>
          <input id="t" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="HTTP Requests and Responses" maxLength={150} />
          <label htmlFor="o">Learning objective</label>
          <textarea id="o" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="Explain GET and POST methods and distinguish between 2xx, 4xx, and 5xx response status categories." maxLength={600} />
          <div style={{ marginTop: 10 }}><button className="btn primary" disabled={creating}>{creating ? 'Creating…' : '+ Create'}</button></div>
        </form>
        <h3>Your lessons</h3>
        {!lessons.length && <div className="muted">Nothing yet.</div>}
        {lessons.map((l) => (
          <div key={l.id} className={`lesson-item ${sel === l.id ? 'active' : ''}`} onClick={() => { if (dirty && !window.confirm('Discard unsaved edits?')) return; setSel(l.id); }}>
            <div className="t">{l.title}</div>
            <div className="o">{l.objective}</div>
            <div className="row between" style={{ marginTop: 4 }}>
              <Badge s={l.hasLesson ? 'done' : 'idle'}>{l.hasLesson ? 'has lesson' : 'draft'}</Badge>
              <button className="btn small red" onClick={(e) => { e.stopPropagation(); remove(l.id); }}>✕</button>
            </div>
          </div>
        ))}
      </aside>

      <main className="main">
        {!rec && <div className="card"><h2>Welcome 👋</h2><p>Create a lesson on the left, or pick an existing one. LessonForge will research books, websites and YouTube, write a 45-minute lesson, then audit it with two independent QC layers.</p></div>}
        {rec && (
          <>
            <div className="row between no-print">
              <div><h1 style={{ marginBottom: 2 }}>{rec.title}</h1><div className="muted" style={{ maxWidth: 780 }}>🎯 {rec.objective}</div></div>
              <button className="btn green" disabled={anyBusy} onClick={runAll}>▶ Run full pipeline</button>
            </div>
            <div style={{ height: 14 }} />
            <Pipeline rec={rec} busy={busy} onRun={run} labels={STEP_LABEL} />
            <div className="tabs no-print">
              {tabs.map(([k, label]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}{k === 'lesson' && dirty ? ' •' : ''}</button>)}
            </div>
            {tab === 'sources' && <SourcesTab rec={rec} />}
            {/* Always mounted (just hidden) so unsaved edits survive switching tabs. */}
            <div style={{ display: tab === 'lesson' ? 'block' : 'none' }}><EditorTab key={`${rec.id}-${rec.version}`} rec={rec} setDirty={setDirty} onSaved={(r) => { setRec(r); refreshList(); say('Saved as a new version.', true); }} onError={say} onRestore={async (v) => { try { setRec(await api.restore(rec.id, v)); say(`Restored v${v} as a new version.`, true); } catch (e) { say(e.message); } }} onRun={run} busy={busy} /></div>
            {tab === 'qc1' && <QCTab layer="qc1" rec={rec} dirty={dirty} busy={busy.qc1} onRun={run} setRec={setRec} say={say} />}
            {tab === 'qc2' && <QCTab layer="qc2" rec={rec} dirty={dirty} busy={busy.qc2} onRun={run} setRec={setRec} say={say} />}
            {tab === 'preview' && <PreviewTab rec={rec} dirty={dirty} />}
            {tab === 'export' && <ExportTab rec={rec} dirty={dirty} />}
          </>
        )}
      </main>
      {toast && <div className={`toast ${toast.ok ? 'ok' : ''}`} role="alert"><button onClick={() => setToast(null)} aria-label="close">×</button>{toast.msg}</div>}
    </div>
  );
}
