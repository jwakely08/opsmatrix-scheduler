// A minimal ZIP writer for the Client Schedule Export. The template's parts
// ship pre-extracted under public/templates/, get their cell values patched,
// and are re-packed here with STORED (uncompressed) entries — Excel and
// Numbers open stored zips happily, and skipping compression means no
// deflate dependency and nothing platform-specific. Pure, unit-testable.

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
