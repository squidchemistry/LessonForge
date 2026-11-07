import React, { useState } from 'react';
import { Md, Badge, totalMinutes } from './ui.jsx';

function Quiz({ quiz }) {
  const [picked, setPicked] = useState({});
  return quiz.map((q, i) => {
    const p = picked[q.id];
    return (
      <div className="quiz-q" key={q.id}>
        <b>Q{i + 1}. {q.question}</b>
        {q.options.map((o, j) => (
          <button key={j} className={`opt ${p !== undefined ? (j === q.answerIndex ? 'right' : j === p ? 'wrong' : '') : ''}`} onClick={() => setPicked({ ...picked, [q.id]: j })}>{'ABCD'[j]}. {o}</button>
        ))}
        {p !== undefined && <div style={{ marginTop: 6 }}><b>{p === q.answerIndex ? '✅ Correct.' : `❌ Answer: ${'ABCD'[q.answerIndex]}.`}</b> <Md text={q.explanation} /></div>}
      </div>
    );
  });
}

export default function PreviewTab({ rec, dirty }) {
  const l = rec.lesson;
  if (!l) return <div className="card">Nothing to preview yet.</div>;
  const hasCheck = l.sections.some((s) => s.kind === 'check');
  return (
    <div>
      {dirty && <div className="notice no-print">Preview shows the last <b>saved</b> version; you have unsaved edits in the editor.</div>}
      <div className="row no-print" style={{ marginBottom: 12 }}><button className="btn blue" onClick={() => window.print()}>🖨 Print / Save as PDF</button><span className="muted">v{rec.version}</span></div>
      <article className="preview">
        <h1>{l.title}</h1>
        <p><b>🎯 Objective:</b> {l.objective}</p>
        <p><Badge s={totalMinutes(l) === 45 ? 'done' : 'failed'}>{totalMinutes(l)} minutes</Badge></p>
        <p>{l.summary}</p>
        {l.learningOutcomes.length > 0 && <><h2>You will be able to</h2><ul>{l.learningOutcomes.map((o, i) => <li key={i}>{o}</li>)}</ul></>}
        {l.sections.map((s) => (
          <section key={s.id}>
            <h2>{s.heading} <span style={{ fontSize: 14 }}>· {s.minutes} min</span></h2>
            <Md text={s.content} />
            {s.kind === 'check' && <Quiz quiz={l.quiz} />}
          </section>
        ))}
        {!hasCheck && l.quiz.length > 0 && <section><h2>Knowledge check</h2><Quiz quiz={l.quiz} /></section>}
        {l.videos.length > 0 && (
          <section>
            <h2>Supplementary videos (optional)</h2>
            <div className="videos">
              {l.videos.map((v) => (
                <a className="video" key={v.sourceId} href={v.url} target="_blank" rel="noreferrer">
                  {v.videoId && <img src={`https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`} alt="" />}
                  <div><b>{v.title}</b><br />{v.channel}{v.minutes ? ` · ${Math.round(v.minutes)} min` : ''}<br /><i>{v.why}</i></div>
                </a>
              ))}
            </div>
          </section>
        )}
        <section>
          <h2>References</h2>
          <ol style={{ paddingLeft: 0, listStyle: 'none' }}>
            {l.references.map((r) => <li key={r.id} id={`ref-${r.id}`}>[{r.id.slice(1)}] <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> <span className="muted">({r.type}{r.note ? ` · ${r.note}` : ''})</span></li>)}
          </ol>
        </section>
      </article>
    </div>
  );
}
