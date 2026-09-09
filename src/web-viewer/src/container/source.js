// Sources return owned, exact buffers. Nothing below extracts to a filesystem.
export function checkRange(size, offset, length) {
  if (![size, offset, length].every(Number.isSafeInteger) ||
      offset < 0 || length < 0 || offset > size || length > size - offset) {
    throw new Error('Read extent is outside the package');
  }
}

export function bytesSource(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input.slice(0)) : Uint8Array.from(input);
  return {
    size: bytes.length,
    async read(offset, length) {
      checkRange(bytes.length, offset, length);
      return bytes.slice(offset, offset + length);
    },
  };
}

export function blobSource(blob) {
  return {
    size: blob.size,
    async read(offset, length) {
      checkRange(blob.size, offset, length);
      return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
    },
  };
}

export async function readExact(source, offset, length) {
  checkRange(source.size, offset, length);
  const bytes = await source.read(offset, length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new Error('Package source returned a short or invalid read');
  }
  return bytes.byteOffset === 0 && bytes.buffer.byteLength === length
    ? bytes : Uint8Array.from(bytes);
}
