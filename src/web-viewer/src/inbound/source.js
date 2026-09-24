export function normalizeSource(source) {
  if (source instanceof Blob) return {blob: source, sourceKind: 'file'};
  if (source?.sourceKind !== 'host') return source;
  if (!(source.blob instanceof Blob) || !source.path || !source.name)
    throw new TypeError('A host source needs bytes, an absolute path and a name.');
  return {...source, blob: new File([source.blob], source.name, {type: source.blob.type})};
}
