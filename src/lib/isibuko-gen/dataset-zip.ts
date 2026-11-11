const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function safePackageId(value: string) {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[._]+|[._]+$/g, "");
  return (cleaned || "sample").slice(0, 80);
}

export function packageImageName(sampleId: string, imageName: string) {
  const match = imageName.toLowerCase().match(/\.(png|jpe?g|webp)$/);
  const suffix = match ? `.${match[1] === "jpeg" ? "jpeg" : match[1]}` : ".png";
  return `images/${safePackageId(sampleId)}${suffix}`;
}

function bytes(text: string) {
  return new TextEncoder().encode(text);
}

function write32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

export function storeZip(files: { name: string; data: Uint8Array }[]) {
  for (const file of files) {
    if (!file.name || file.name.includes("\\") || file.name.startsWith("/") || file.name.split("/").some((part) => part === ".." || part === "." || part === "")) {
      throw new Error(`Path traversal rejected: ${file.name}`);
    }
  }
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = bytes(file.name);
    const checksum = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    localView.setUint16(8, 0, true);
    write32(localView, 14, checksum);
    write32(localView, 18, file.data.length);
    write32(localView, 22, file.data.length);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    const record = new Uint8Array(46 + name.length);
    const recordView = new DataView(record.buffer);
    write32(recordView, 0, 0x02014b50);
    write32(recordView, 16, checksum);
    write32(recordView, 20, file.data.length);
    write32(recordView, 24, file.data.length);
    recordView.setUint16(28, name.length, true);
    write32(recordView, 42, offset);
    record.set(name, 46);
    locals.push(local, file.data);
    central.push(record);
    offset += local.length + file.data.length;
  }
  const centralBytes = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  write32(endView, 12, centralBytes);
  write32(endView, 16, offset);
  const out = new Uint8Array(offset + centralBytes + end.length);
  let cursor = 0;
  for (const chunk of [...locals, ...central, end]) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}
