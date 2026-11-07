import React, { useState } from 'react';
import { api } from '../api.js';
import { Badge, when } from './ui.jsx';

export default function QCTab({ layer, rec, dirty, busy, onRun, setRec, say }) {
  const rep = rec[layer];
  const step = rec.steps[layer];
  const [working, setWorking] = useState(null);
  const name = layer === 'qc1' ? 'QC Layer 1 - Research & Factual Accuracy' : 'QC Layer 2 - Instructional Quality';

  if (!rep) {
    return (
      <div className="card">
        <h3>{name}</h3>
        <p>{layer === 'qc1' ? 'Verifies claims against the sources and fresh independent searches, rates source reliability, checks links, finds gaps and inconsistencies.' : 'Checks alignment with the learning objective, clarity, structure, examples, practical application, assessment quality and timing.'}</p>
        {step.status === 'failed' && <div className="notice bad">Last run failed: {step.error}</div>}
        {!rec.lesson ? <div className="muted">Generate a lesson first.</div> : <button className="btn primary" disabled={busy} onClick={() => onRun(layer)}>{busy ? 'Running…' : step.status === 'failed' ? '↻ Retry audit' : '▶ Run audit'}</button>}
      </div>
    );
  }

  async function act(issue, action) {
    setWorking(issue.id);
    try {
      setRec(await api.issue(rec.id, layer, issue.id, action));
      if (action === 'apply') say(`Applied ${issue.id}. A new lesson version was created.`, true);
    } catch (e) { say(e.message); } finally { setWorking(null); }
  }

  const stale = rep.forVersion !== rec.version;
  const open = rep.issues.filter((i) => i.status === 'open').length;

  return (
    <div>
      {step.status === 'failed' && <div className="notice bad">A re-run failed ({step.error}). Showing the previous report.</div>}
      {stale && <div className="notice">⚠ The lesson has changed since this audit (audited v{rep.forVersion}, current v{rec.version}). Re-run to refresh.</div>}
      <div className="card">
        <div className="row between">
          <div className="row"><div className="scorebox">{rep.score}</div><div><h3 style={{ margin: 0 }}>{name}</h3><Badge s={rep.verdict} /> <span className="muted">· {when(rep.at)} · {open} open issue{open === 1 ? '' : 's'}</span></div></div>
          <button className="btn yellow" disabled={busy} onClick={() => onRun(layer)}>{busy ? 'Running…' : '↻ Re-run'}</button>
        </div>
        <p>{rep.summary}</p>
      </div>

      <h2>Issues &amp; suggested improvements</h2>
      {dirty && <div className="notice">Save or discard your unsaved edits before applying fixes.</div>}
      {!rep.issues.length && <div className="card">No issues found.</div>}
      {rep.issues.map((i) => (
        <div key={i.id} className={`issue ${i.status}`}>
          <div className="row"><b>{i.id}</b><Badge s={i.severity} /><Badge s="idle">{i.type}</Badge>{i.sectionId && <span className="mono muted">{i.sectionId}</span>}<Badge s={i.status === 'open' ? 'idle' : i.status} /></div>
          <p style={{ margin: '8px 0 4px' }}><b>Problem:</b> {i.problem}</p>
          {i.evidence && <p style={{ margin: '4px 0' }}><b>Evidence:</b> {i.evidence}</p>}
          <p style={{ margin: '4px 0' }}><b>Suggestion:</b> {i.suggestion}</p>
          {i.patch && (
            <div className="diff">
              {i.patch.find && <div className="del">− {i.patch.find}</div>}
              <div className="add">{i.patch.op === 'append' ? '＋ (append) ' : '+ '}{i.patch.replace}</div>
            </div>
          )}
          <div className="row no-print" style={{ marginTop: 10 }}>
            {i.status === 'open' && i.patch && <button className="btn small green" disabled={dirty || working === i.id} onClick={() => act(i, 'apply')}>✔ Apply fix</button>}
            {i.status === 'open' && !i.patch && <span className="muted">No automatic fix - edit manually, then dismiss.</span>}
            {i.status === 'open' && <button className="btn small" disabled={working === i.id} onClick={() => act(i, 'dismiss')}>Dismiss</button>}
            {i.status !== 'open' && i.status !== 'applied' && <button className="btn small" onClick={() => act(i, 'reopen')}>Reopen</button>}
          </div>
        </div>
      ))}

      {layer === 'qc1' ? <Qc1Body rep={rep} /> : <Qc2Body rep={rep} />}
      {rep.gaps?.length > 0 && <><h2>Gaps</h2><div className="card"><ul>{rep.gaps.map((g, k) => <li key={k}>{g}</li>)}</ul></div></>}
    </div>
  );
}

function Qc1Body({ rep }) {
  return (
    <>
      <h2>Claim verification</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Section</th><th>Claim</th><th>Status</th><th>Evidence</th></tr></thead>
          <tbody>{rep.claims.map((c, k) => <tr key={k}><td className="mono">{c.sectionId}</td><td>{c.claim}</td><td><Badge s={c.status} /></td><td>{c.evidence} <b>{(c.sourceIds || []).join(' ')}</b></td></tr>)}</tbody></table>
      </div>
      <h2>Source reliability &amp; relevance</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Source</th><th>Reliability</th><th>Relevance</th><th>Note</th></tr></thead>
          <tbody>{rep.sourceAssessment.map((s, k) => <tr key={k}><td><b>{s.sourceId}</b></td><td><Badge s={s.reliability} /></td><td><Badge s={s.relevance} /></td><td>{s.note}</td></tr>)}</tbody></table>
      </div>
      <h2>Automated link check</h2>
      <div className="card">{rep.linkChecks.map((l, k) => <div key={k} className="row" style={{ marginBottom: 4 }}><Badge s={l.status}>{l.status} {l.code ?? ''}</Badge><a href={l.url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all', fontWeight: 400 }}>{l.title || l.url}</a></div>)}</div>
      {rep.independentEvidence?.length > 0 && (
        <><h2>Independent verification searches</h2><div className="card">{rep.independentEvidence.map((e, k) => <div key={k} style={{ marginBottom: 8 }}><b>“{e.query}”</b><div className="muted mono" style={{ wordBreak: 'break-all' }}>{e.urls.join(' · ') || e.error || 'no results'}</div></div>)}</div></>
      )}
      {rep.inconsistencies?.length > 0 && <><h2>Inconsistencies</h2><div className="card"><ul>{rep.inconsistencies.map((g, k) => <li key={k}>{g}</li>)}</ul></div></>}
    </>
  );
}

function Qc2Body({ rep }) {
  return (
    <>
      <h2>Objective alignment ({rep.alignment?.score}/5)</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Objective part</th><th>Coverage</th><th>Taught in</th><th>Assessed by</th><th>Note</th></tr></thead>
          <tbody>{(rep.alignment?.objectiveParts || []).map((p, k) => <tr key={k}><td>{p.part}</td><td><Badge s={p.coverage} /></td><td className="mono">{p.taughtIn}</td><td>{p.assessedBy}</td><td>{p.note}</td></tr>)}</tbody></table>
      </div>
      <h2>Quality dimensions</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Dimension</th><th>Score</th><th>Note</th></tr></thead>
          <tbody>{rep.dimensions.map((d, k) => <tr key={k}><td><b>{d.name}</b></td><td>{'■'.repeat(d.score)}{'□'.repeat(Math.max(0, 5 - d.score))} {d.score}/5</td><td>{d.note}</td></tr>)}</tbody></table>
      </div>
      {rep.stats && <div className="muted">Measured: {rep.stats.minutes} planned min · ~{rep.stats.readingMinutes} min reading time · {rep.stats.quizQuestions} quiz questions.</div>}
    </>
  );
}
