/** Read bounded NDJSON, including a final line without a newline. Always release the reader. */
export async function readNdjson(
  response: Response,
  onValue: (value: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The server returned an empty response.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let total = 0;
  const consume = (line: string) => {
    if (!line.trim()) return;
    signal?.throwIfAborted();
    onValue(JSON.parse(line));
  };
  const cancel = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) consume(buffer);
        break;
      }
      total += value.byteLength;
      if (total > 16 * 1024 * 1024)
        throw new Error("The search response is too large.");
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        consume(line);
      }
      if (buffer.length > 4 * 1024 * 1024)
        throw new Error("The search response is too large.");
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
