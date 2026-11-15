export function downloadWorkspaceExport(data, {
  documentRef = document,
  urlApi = URL,
  now = new Date(),
  schedule = setTimeout,
} = {}) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = urlApi.createObjectURL(blob);
  const filename = `story-markets-export-${now.toISOString().slice(0, 10)}.json`;
  const link = documentRef.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  documentRef.body.append(link);
  link.click();
  link.remove();
  schedule(() => urlApi.revokeObjectURL(url), 0);
  return filename;
}
