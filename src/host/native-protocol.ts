export function encodeNativeMessage(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function decodeNativeMessages(buffer: Buffer): unknown[] {
  const messages: unknown[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (buffer.length - offset < 4) {
      throw new Error("Incomplete native message frame header");
    }

    const length = buffer.readUInt32LE(offset);
    offset += 4;

    if (buffer.length - offset < length) {
      throw new Error("Incomplete native message frame payload");
    }

    messages.push(JSON.parse(buffer.subarray(offset, offset + length).toString("utf8")));
    offset += length;
  }

  return messages;
}
