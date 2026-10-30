// O(len)
// INV: frames end at a blank line; the unterminated tail is returned as rest; ':' comment lines, "[DONE]" and malformed JSON are skipped
export function parseSseChunk(buf: string): { events: unknown[]; rest: string } {
  const frames = buf.replace(/\r\n/g, "\n").split("\n\n");
  const rest = frames.pop() ?? "";
  const events: unknown[] = [];
  for (const frame of frames) {
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
    }
    const payload = data.join("\n");
    if (data.length === 0 || payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      continue;
    }
  }
  return { events, rest };
}
