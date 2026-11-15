import { describe, expect, it } from 'vitest';
import { downloadWorkspaceExport } from '../creator/src/export.js';

describe('workspace export download', () => {
  it('downloads the selected owner bundle as dated JSON and revokes the temporary URL', async () => {
    const data = { schema: 'story-markets.workspace-export.v1', narratives: [{ id: 'n-1' }] };
    let blob;
    let revoked;
    let appended;
    const link = { click() { this.clicked = true; }, remove() { this.removed = true; } };
    const documentRef = {
      createElement(tag) { expect(tag).toBe('a'); return link; },
      body: { append(element) { appended = element; } },
    };
    const urlApi = {
      createObjectURL(value) { blob = value; return 'blob:workspace-export'; },
      revokeObjectURL(value) { revoked = value; },
    };
    const filename = downloadWorkspaceExport(data, {
      documentRef,
      urlApi,
      now: new Date('2026-10-07T09:00:00.000Z'),
      schedule: (callback) => callback(),
    });
    expect(filename).toBe('story-markets-export-2026-10-07.json');
    expect(link.download).toBe(filename);
    expect(link.href).toBe('blob:workspace-export');
    expect(appended).toBe(link);
    expect(link.clicked).toBe(true);
    expect(link.removed).toBe(true);
    expect(await blob.text()).toBe(JSON.stringify(data, null, 2));
    expect(revoked).toBe('blob:workspace-export');
  });
});
