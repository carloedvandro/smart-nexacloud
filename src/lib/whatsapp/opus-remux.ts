/**
 * Converte a gravação WebM/Opus do navegador em OGG/Opus — o mesmo formato que
 * o WhatsApp usa nos áudios gravados no celular. Com OGG/Opus a mensagem chega
 * como "áudio de voz" (bolha verde com ondinha e foto), e não como arquivo MP3.
 *
 * Não recodificamos nada: apenas trocamos o "envelope" (WebM -> OGG), então é
 * rápido e sem perda de qualidade.
 */

type Reader = { data: Uint8Array; pos: number };

function readVint(r: Reader, stripMarker: boolean): number | null {
  if (r.pos >= r.data.length) return null;
  const first = r.data[r.pos]!;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8) return null;
  let value = stripMarker ? first & (mask - 1) : first;
  for (let i = 1; i < length; i += 1) {
    const byte = r.data[r.pos + i];
    if (byte === undefined) return null;
    value = value * 256 + byte;
  }
  r.pos += length;
  return value;
}

const MASTER = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0xa0]);

/** Extrai os pacotes Opus (e o cabeçalho CodecPrivate) do WebM. */
function parseWebm(data: Uint8Array): { header: Uint8Array | null; packets: Uint8Array[] } {
  const packets: Uint8Array[] = [];
  let header: Uint8Array | null = null;

  const walk = (start: number, end: number) => {
    const r: Reader = { data, pos: start };
    while (r.pos < end) {
      const id = readVint(r, false);
      if (id === null) return;
      const size = readVint(r, true);
      if (size === null) return;
      const contentStart = r.pos;
      const contentEnd = Math.min(end, contentStart + size);
      if (MASTER.has(id)) {
        walk(contentStart, contentEnd);
      } else if (id === 0x63a2 && !header) {
        header = data.subarray(contentStart, contentEnd);
      } else if (id === 0xa3 || id === 0xa1) {
        // SimpleBlock/Block: track (vint) + timecode(2) + flags(1) + payload
        const br: Reader = { data, pos: contentStart };
        readVint(br, true);
        const payloadStart = br.pos + 3;
        if (payloadStart < contentEnd) packets.push(data.subarray(payloadStart, contentEnd));
      }
      r.pos = contentEnd;
    }
  };

  walk(0, data.length);
  return { header, packets };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 0x80000000 ? ((value << 1) ^ 0x04c11db7) >>> 0 : (value << 1) >>> 0;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = ((crc << 8) >>> 0) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]!) & 0xff]!;
    crc = crc >>> 0;
  }
  return crc >>> 0;
}

/** Duração do pacote Opus em amostras de 48 kHz, lida do byte TOC. */
function packetSamples(packet: Uint8Array): number {
  const toc = packet[0];
  if (toc === undefined) return 960;
  const config = toc >> 3;
  let frameMs: number;
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4]!;
  else if (config < 16) frameMs = [10, 20][config % 2]!;
  else frameMs = [2.5, 5, 10, 20][config % 4]!;
  const code = toc & 0x03;
  let frames = 1;
  if (code === 1 || code === 2) frames = 2;
  else if (code === 3) frames = (packet[1] ?? 1) & 0x3f || 1;
  return Math.round(frameMs * 48 * frames);
}

function buildPage(
  payloads: Uint8Array[],
  headerType: number,
  granule: number,
  serial: number,
  sequence: number,
): Uint8Array {
  const segments: number[] = [];
  for (const payload of payloads) {
    let remaining = payload.length;
    while (remaining >= 255) {
      segments.push(255);
      remaining -= 255;
    }
    segments.push(remaining);
  }
  const bodyLength = payloads.reduce((sum, p) => sum + p.length, 0);
  const page = new Uint8Array(27 + segments.length + bodyLength);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page[4] = 0;
  page[5] = headerType;
  // granule (64 bits little-endian)
  view.setUint32(6, granule >>> 0, true);
  view.setUint32(10, Math.floor(granule / 0x100000000), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  view.setUint32(22, 0, true); // checksum placeholder
  page[26] = segments.length;
  page.set(segments, 27);
  let offset = 27 + segments.length;
  for (const payload of payloads) {
    page.set(payload, offset);
    offset += payload.length;
  }
  view.setUint32(22, crc32(page), true);
  return page;
}

function defaultOpusHead(channels: number): Uint8Array {
  const head = new Uint8Array(19);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // OpusHead
  head[8] = 1; // version
  head[9] = channels;
  head[10] = 0x38; // pre-skip 312
  head[11] = 0x01;
  new DataView(head.buffer).setUint32(12, 48000, true);
  return head;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("NexaAtende");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); // OpusTags
  const view = new DataView(tags.buffer);
  view.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true);
  return tags;
}

/** Retorna um Blob OGG/Opus, ou null quando a gravação não é WebM/Opus. */
export async function webmOpusToOgg(recording: Blob): Promise<Blob | null> {
  const type = (recording.type || "").toLowerCase();
  if (!type.includes("webm")) return null;

  const data = new Uint8Array(await recording.arrayBuffer());
  const { header, packets } = parseWebm(data);
  if (!packets.length) return null;

  const head = header && header.length >= 19 ? header : defaultOpusHead(1);
  const serial = Math.floor(Math.random() * 0xffffffff) >>> 0;
  const pages: Uint8Array[] = [];
  let sequence = 0;

  pages.push(buildPage([head], 0x02, 0, serial, sequence++));
  pages.push(buildPage([opusTags()], 0x00, 0, serial, sequence++));

  let granule = 0;
  const perPage = 20;
  for (let i = 0; i < packets.length; i += perPage) {
    const slice = packets.slice(i, i + perPage);
    for (const packet of slice) granule += packetSamples(packet);
    const last = i + perPage >= packets.length;
    pages.push(buildPage(slice, last ? 0x04 : 0x00, granule, serial, sequence++));
  }

  const total = pages.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const page of pages) {
    out.set(page, offset);
    offset += page.length;
  }
  return new Blob([out], { type: "audio/ogg; codecs=opus" });
}
