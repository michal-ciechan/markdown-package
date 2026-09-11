// New dynamic imports count by default, including nested startup capabilities.
// Exclusions must name an explicitly audited, conditional feature entry point.
export function budgetClosure(start, records, deferredEntryPoints = new Set()) {
  const reached = new Set();
  function visit(file) {
    if (reached.has(file)) return;
    const record = records.get(file);
    if (!record) throw new Error(`Unresolved internal chunk in build graph: ${file}`);
    reached.add(file);
    for (const imported of record.imports ?? []) {
      if (imported.external) continue;
      if (imported.kind === 'dynamic-import' && deferredEntryPoints.has(records.get(imported.path)?.entryPoint)) continue;
      visit(imported.path);
    }
    if (record.cssBundle) visit(record.cssBundle);
  }
  for (const file of start) visit(file);
  return reached;
}
