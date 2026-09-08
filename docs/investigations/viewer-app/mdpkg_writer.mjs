// A conforming-tier ZIP writer for the container profile (spec.md §3.1-§3.5),
// using only APIs a browser has: CompressionStream('deflate-raw') and typed
// arrays. It exists to answer one question — can a page emit a package a native
// Git and an ordinary ZIP tool both accept — not to be a producer.
//
// What it cannot do: choose a DEFLATE level. §3.3 makes level producer policy,
// so this is conforming; it is not byte-identical to a level-6 emitter.
import {crc32} from './mdpkg_reader.mjs';

const enc = new TextEncoder();

async function deflateRaw(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  w.write(bytes); w.close();
  const chunks = []; let total = 0;
  for (const r = cs.readable.getReader();;) {
    const {done, value} = await r.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// entries: [{name, bytes, stored?}] in the order §3.2 requires.
export async function writePackage(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const push = a => { parts.push(a); offset += a.length; };

  for (const e of entries) {
    const name = enc.encode(e.name);
    const nonAscii = name.some(b => b > 0x7f);
    let method = 0, payload = e.bytes;
    if (!e.stored) {
      const d = await deflateRaw(e.bytes);
      if (d.length < e.bytes.length) { method = 8; payload = d; }
    }
    const crc = crc32(e.bytes);
    const flags = nonAscii ? 0x0800 : 0;               // bit 11 for UTF-8 names, bit 3 never set
    const localOffset = offset;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, flags, true);
    lh.setUint16(8, method, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, payload.length, true);
    lh.setUint32(22, e.bytes.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    push(new Uint8Array(lh.buffer)); push(name); push(payload);
    central.push({name, flags, method, crc, csize: payload.length, usize: e.bytes.length, localOffset});
  }

  const cdStart = offset;
  for (const c of central) {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true);
    h.setUint16(8, c.flags, true); h.setUint16(10, c.method, true);
    h.setUint16(12, 0, true); h.setUint16(14, 0x21, true);
    h.setUint32(16, c.crc, true); h.setUint32(20, c.csize, true); h.setUint32(24, c.usize, true);
    h.setUint16(28, c.name.length, true); h.setUint16(30, 0, true); h.setUint16(32, 0, true);
    h.setUint16(34, 0, true);
    h.setUint16(36, 0, true);                          // §3.5 D-19: internal attributes 0, text bit clear
    h.setUint32(38, 0, true); h.setUint32(42, c.localOffset, true);
    push(new Uint8Array(h.buffer)); push(c.name);
  }
  const cdSize = offset - cdStart;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, central.length, true); eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, cdStart, true);
  eocd.setUint16(20, 0, true);                         // §3.5: zero-length comment
  push(new Uint8Array(eocd.buffer));

  const out = new Uint8Array(offset); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
