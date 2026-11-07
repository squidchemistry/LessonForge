import React from 'react';

export default function ExportTab({ rec, dirty }) {
  if (!rec.lesson) return <div className="card">Generate a lesson before exporting.</div>;
  const base = `/api/lessons/${rec.id}`;
  const files = [
    ['lesson.md', 'Finalized lesson (markdown)', true],
    ['references.md', 'References and acknowledgements', true],
    ['qc1-factual-report.md', 'QC Layer 1 audit report', !!rec.qc1],
    ['qc2-instructional-report.md', 'QC Layer 2 audit report', !!rec.qc2],
  ];
  return (
    <div>
      {dirty && <div className="notice">You have unsaved edits - exports use the last <b>saved</b> version (v{rec.version}). Save first.</div>}
      <div className="card">
        <h3>Export finalized lesson (v{rec.version})</h3>
        <p>One ZIP with the lesson, references, both QC reports (including which recommendations were applied or dismissed) and a JSON data file.</p>
        <a className="btn primary" href={`${base}/export.zip`}>⬇ Download everything (.zip)</a>
      </div>
      <div className="card">
        <h3>Individual files</h3>
        {files.map(([f, d, ok]) => (
          <div className="row between" key={f} style={{ marginBottom: 8 }}>
            <span><b className="mono">{f}</b> — {d}{!ok && ' (run this audit first for real content)'}</span>
            <a className="btn small blue" href={`${base}/export/${f}`}>⬇ Download</a>
          </div>
        ))}
        <p className="muted">Tip: for a PDF, open the Preview tab and use Print → Save as PDF.</p>
      </div>
    </div>
  );
}
