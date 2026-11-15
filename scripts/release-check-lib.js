const COUNT_FIELDS = ['total', 'critical', 'high', 'moderate', 'low', 'info'];

function normalizeVia(via = []) {
  return via.map((item) => {
    if (typeof item === 'string') return `dependency:${item}`;
    const advisory = item || {};
    return `advisory:${advisory.source ?? ''}:${advisory.url ?? ''}:${advisory.range ?? ''}`;
  }).sort();
}

export function auditSnapshotFromReport(report) {
  const vulnerabilities = report?.vulnerabilities || {};
  const counts = Object.fromEntries(COUNT_FIELDS.map((field) => [
    field,
    Number(report?.metadata?.vulnerabilities?.[field]) || 0,
  ]));
  const findings = Object.entries(vulnerabilities).map(([name, value]) => {
    const finding = {
      name,
      severity: String(value?.severity || 'unknown'),
      range: String(value?.range || ''),
      via: normalizeVia(Array.isArray(value?.via) ? value.via : []),
      nodes: [...(value?.nodes || [])].map(String).sort(),
    };
    return { ...finding, fingerprint: JSON.stringify(finding) };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.fingerprint.localeCompare(b.fingerprint));
  return { counts, findings };
}

export function compareAuditToBaseline(report, baseline) {
  const current = auditSnapshotFromReport(report);
  const known = new Set((baseline?.findings || []).map((finding) => finding.fingerprint));
  const newFindings = current.findings.filter((finding) => !known.has(finding.fingerprint));
  const criticalFindings = current.findings.filter((finding) => finding.severity === 'critical');
  return {
    ok: current.counts.critical === 0 && criticalFindings.length === 0 && newFindings.length === 0,
    current,
    newFindings,
    criticalFindings,
  };
}
