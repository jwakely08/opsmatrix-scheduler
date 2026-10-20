// A minimal ZIP writer for the Client Schedule Export. The template's parts
// ship pre-extracted under public/templates/, get their cell values patched,
// and are re-packed here with STORED (uncompressed) entries — Excel and
// Numbers open stored zips happily, and skipping compression means no
// deflate dependency and nothing platform-specific. Pure, unit-testable.

/**
 * Read a ZIP archive (an uploaded .xlsx): central-directory walk, stored
 * entries sliced straight out, deflated entries inflated with the browser's
 * own DecompressionStream — no library. Throws on anything that isn't a
 * plain zip (encrypted, zip64, multi-disk), with a message a manager can act
 * on ("that file isn't a normal Excel file").
 */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD: scan back over a possible trailing comment
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("that file isn't a normal Excel file (no zip directory)");
  const count = dv.getUint16(eocd + 10, true);
  let at = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(at, true) !== 0x02014b50) throw new Error("that Excel file's zip directory is damaged");
    const method = dv.getUint16(at + 10, true);
    const compSize = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen = dv.getUint16(at + 32, true);
    const localAt = dv.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    // the local header repeats name/extra with its OWN lengths
    const lNameLen = dv.getUint16(localAt + 26, true);
    const lExtraLen = dv.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataAt, dataAt + compSize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error("that Excel file uses a compression this importer can't read");
    if (!name.endsWith("/")) out.push({ name, data });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data.slice() as unknown as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** forward-slash path inside the archive, e.g. "xl/workbook.xml" */
  name: string;
  data: Uint8Array;
}

const enc = new TextEncoder();

export const utf8 = (s: string): Uint8Array => enc.encode(s);

/** Pack entries into a ZIP archive (method 0 = stored). */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

  for (const e of entries) {
    const name = utf8(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(e.data.length), ...u32(e.data.length),
      ...u16(name.length), ...u16(0)
    ]);
    chunks.push(local, name, e.data);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(e.data.length), ...u32(e.data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset)
    ]), name);
    offset += local.length + name.length + e.data.length;
  }

  const centralLen = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(centralLen), ...u32(offset), ...u16(0)
  ]);

  const total = offset + centralLen + eocd.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of [...chunks, ...central, eocd]) { out.set(c, at); at += c.length; }
  return out;
}
