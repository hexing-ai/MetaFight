function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
// ZIP_STORED matches the phone-verified packaging. Fixed timestamp and paths.
export function zipFiles(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, data] of entries.slice().sort((a, b) => a[0].localeCompare(b[0]))) {
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('Unsafe ZIP path');
    const file = Buffer.from(name), packed = data, crc = crc32(data);
    const flags = /[^\x00-\x7f]/.test(name) ? 0x800 : 0;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(flags, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(33, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(file.length, 26);
    local.push(h, file, packed);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(33, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(file.length, 28); c.writeUInt32LE(0x20, 38); c.writeUInt32LE(offset, 42);
    central.push(c, file); offset += h.length + file.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
