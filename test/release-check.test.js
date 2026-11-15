import { describe, expect, it } from 'vitest';
import { auditSnapshotFromReport, compareAuditToBaseline } from '../scripts/release-check-lib.js';

const knownReport = {
  metadata: { vulnerabilities: { total: 1, critical: 0, high: 1, moderate: 0, low: 0, info: 0 } },
  vulnerabilities: {
    'demo-package': {
      name: 'demo-package',
      severity: 'high',
      range: '<2.0.0',
      via: [{ source: 42, name: 'demo-package', title: 'Example advisory', url: 'https://github.com/advisories/GHSA-abcd-efgh-ijkl', range: '<2.0.0' }],
      nodes: ['node_modules/demo-package'],
    },
  },
};

describe('deployment audit baseline', () => {
  it('allows an exact finding already recorded in the accepted baseline', () => {
    const baseline = auditSnapshotFromReport(knownReport);
    const result = compareAuditToBaseline(knownReport, baseline);
    expect(result.ok).toBe(true);
    expect(result.newFindings).toEqual([]);
    expect(result.current.counts.high).toBe(1);
  });

  it('blocks a finding whose package or advisory is not in the baseline', () => {
    const baseline = auditSnapshotFromReport(knownReport);
    const changed = structuredClone(knownReport);
    changed.vulnerabilities['demo-package'].via[0].url = 'https:\/\/github.com\/advisories\/GHSA-new1-new2-new3';
    const result = compareAuditToBaseline(changed, baseline);
    expect(result.ok).toBe(false);
    expect(result.newFindings).toHaveLength(1);
  });

  it('blocks critical findings even if present in the baseline', () => {
    const critical = structuredClone(knownReport);
    critical.metadata.vulnerabilities.critical = 1;
    critical.vulnerabilities['demo-package'].severity = 'critical';
    const baseline = auditSnapshotFromReport(critical);
    const result = compareAuditToBaseline(critical, baseline);
    expect(result.ok).toBe(false);
    expect(result.criticalFindings).toHaveLength(1);
  });
});
