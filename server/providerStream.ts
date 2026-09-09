export class ProviderStreamProtocolError extends Error {
  constructor(message = 'Provider 流式响应无效。') {
    super(message);
    this.name = 'ProviderStreamProtocolError';
  }
}

type StreamChoice = {
  index?: unknown;
  delta?: { content?: unknown };
  finish_reason?: unknown;
};

type StreamPayload = {
  choices?: unknown;
  error?: unknown;
};

type DeltaSink = (delta: string) => void;

const abortedError = () => new DOMException('Aborted', 'AbortError');

const parseStreamPayload = (data: string): StreamPayload => {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    throw new ProviderStreamProtocolError();
  }
  if (!payload || typeof payload !== 'object') throw new ProviderStreamProtocolError();
  return payload as StreamPayload;
};

/**
 * Consume an OpenAI-compatible SSE response. The stream is successful only
 * after a [DONE] event or a non-null finish_reason has been observed.
 */
export const readProviderSse = async (
  response: Response,
  signal: AbortSignal,
  onDelta?: DeltaSink,
): Promise<string> => {
  const body = response.body;
  if (!body) throw new ProviderStreamProtocolError();

  if (signal.aborted) throw abortedError();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let output = '';
  let sawDone = false;
  let sawFinish = false;
  let cancelledByAbort = false;
  let completed = false;

  const processEvent = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    dataLines = [];
    if (data.trim() === '[DONE]') {
      sawDone = true;
      return;
    }
    const payload = parseStreamPayload(data);
    if (payload.error !== undefined && payload.error !== null) {
      throw new ProviderStreamProtocolError();
    }
    if (!Array.isArray(payload.choices)) return;
    const firstChoice = payload.choices[0];
    const typedFirstChoice = firstChoice && typeof firstChoice === 'object'
      ? firstChoice as StreamChoice
      : undefined;
    const typedChoice = typedFirstChoice?.index === undefined
      ? typedFirstChoice
      : payload.choices.find((choice) => (
          choice && typeof choice === 'object' && (choice as StreamChoice).index === 0
        )) as StreamChoice | undefined;
    if (!typedChoice) return;
    const content = typedChoice.delta?.content;
    if (typeof content === 'string') {
      output += content;
      onDelta?.(content);
    }
    if (typeof typedChoice.finish_reason === 'string' && typedChoice.finish_reason.trim()) {
      sawFinish = true;
    }
  };

  const processLine = (line: string) => {
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    if (field !== 'data') return;
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    dataLines.push(value);
  };

  const consumeText = (text: string) => {
    buffer += text;
    while (true) {
      const lineEnd = buffer.search(/[\r\n]/);
      if (lineEnd < 0) return;
      const first = buffer[lineEnd];
      if (first === '\r' && lineEnd + 1 === buffer.length) return;
      const lineLength = first === '\r' && buffer[lineEnd + 1] === '\n' ? 2 : 1;
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + lineLength);
      if (line === '') processEvent();
      else processLine(line);
      if (sawDone) return;
    }
  };

  const abortReader = () => {
    cancelledByAbort = true;
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abortReader, { once: true });
  try {
    if (signal.aborted) throw abortedError();
    while (!sawDone) {
      if (signal.aborted || cancelledByAbort) throw abortedError();
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (error) {
        if (signal.aborted || cancelledByAbort) throw abortedError();
        throw error;
      }
      if (read.done) break;
      consumeText(decoder.decode(read.value, { stream: true }));
    }
    if (signal.aborted || cancelledByAbort) throw abortedError();
    if (!sawDone) {
      consumeText(decoder.decode());
      if (buffer.endsWith('\r')) {
        const line = buffer.slice(0, -1);
        buffer = '';
        if (line === '') processEvent();
        else processLine(line);
      } else if (buffer) {
        processLine(buffer);
        buffer = '';
      }
      processEvent();
    }
    if (!sawDone && !sawFinish) throw new ProviderStreamProtocolError('Provider 流式响应未正常结束。');
    if (!output.trim()) throw new ProviderStreamProtocolError('Provider 没有返回可写入正文的文本。');
    completed = true;
    return output.trim();
  } finally {
    signal.removeEventListener('abort', abortReader);
    if (sawDone || !completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
};
