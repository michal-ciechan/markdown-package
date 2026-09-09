let nativeRaw;
export function hasNativeInflate() {
  if (nativeRaw === undefined) {
    try { new DecompressionStream('deflate-raw'); nativeRaw = true; }
    catch { nativeRaw = false; }
  }
  return nativeRaw;
}

export async function inflateRaw(raw, expected) {
  const chunks = [];
  let size = 0;
  const accept = chunk => {
    size += chunk.length;
    if (size > expected) throw new Error('Decoded output exceeds the directory size');
    chunks.push(chunk);
  };
  if (hasNativeInflate()) {
    const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    try {
      for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        accept(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  } else {
    const {inflateFallback} = await import('./inflate-fallback.js');
    inflateFallback(raw, accept);
  }
  if (size !== expected) throw new Error('Decoded length disagrees with the directory');
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
