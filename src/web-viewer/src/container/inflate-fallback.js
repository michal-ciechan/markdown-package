import {Inflate} from 'fflate';

// Separate entry point lets esbuild retain only the inflater in the lazy chunk.
export function inflateFallback(raw, accept) {
  const inflater = new Inflate(accept);
  // Small compressed chunks bound transient expansion before the size check.
  if (!raw.length) throw new Error('Empty DEFLATE stream');
  for (let offset = 0; offset < raw.length; offset += 256) {
    inflater.push(raw.subarray(offset, offset + 256), offset + 256 >= raw.length);
  }
  // fflate 0.8.2 does not reject an absent final block in
  // its public API. Check its pinned stream state: f = BFINAL, l = active
  // Huffman block. Trailing input is accepted to match the native decoder.
  // Recheck this adapter before changing the pinned dependency version.
  if (!inflater.s.f || inflater.s.l) {
    throw new Error('Incomplete DEFLATE stream');
  }
}
