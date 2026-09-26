import type { PromptMessage } from '../../src/types.ts';
import { readProviderSse, ProviderStreamProtocolError } from '../providerStream.ts';
import { finishReasonAllowsEmptyDraft, mapProviderFinishReason, type ProviderGenerationResult } from '../providerResult.ts';
import { ProviderCancelledError, ProviderConnectionError, ProviderInputError } from './errors.ts';
import { assertAllowedDestination, endpoint, parseProviderUrl } from './destinationPolicy.ts';
import { normalizeApiKey, type StoredProviderProfile } from './profiles.ts';

export type ProviderGenerationOptions = {
  stream?: boolean;
  onDelta?: (delta: string) => void;
};

const readProviderJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new ProviderConnectionError('Provider 返回的数据无效。');
  }
};

const readErrorStatus = (status: number) => status === 401 || status === 403
  ? 'Provider 拒绝了本机凭据。'
  : `Provider 返回 HTTP ${status}。`;

export const testProviderConnection = async (candidate: StoredProviderProfile): Promise<{ ok: true; modelId: string }> => {
  if (candidate.kind === 'fake') return { ok: true, modelId: candidate.modelId };
  const parsed = parseProviderUrl(candidate.baseUrl);
  await assertAllowedDestination(parsed);
  let response: Response;
  try {
    response = await fetch(endpoint(parsed.url, 'models'), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${candidate.apiKey}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ProviderConnectionError('无法连接本机 Provider。');
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ProviderConnectionError('Provider 重定向被拒绝。');
  }
  if (!response.ok) throw new ProviderConnectionError(readErrorStatus(response.status));
  const payload = await readProviderJson(response) as { data?: Array<{ id?: unknown }> };
  const ids = Array.isArray(payload.data)
    ? payload.data.map((item) => item?.id).filter((id): id is string => typeof id === 'string')
    : [];
  if (ids.length && !ids.includes(candidate.modelId)) {
    throw new ProviderConnectionError('连接成功，但模型列表中没有这个模型 ID。');
  }
  return { ok: true, modelId: candidate.modelId };
};

export const generateProviderCompletion = async (
  profile: StoredProviderProfile,
  messages: PromptMessage[],
  externalSignal?: AbortSignal,
  options: ProviderGenerationOptions = {},
): Promise<ProviderGenerationResult | null> => {
  if (externalSignal?.aborted) throw new ProviderCancelledError();
  if (profile.kind === 'fake') return null;
  const apiKey = normalizeApiKey(profile.apiKey);
  if (!apiKey) throw new ProviderInputError('所选连接方案没有本机 API Key。');
  const stream = options.stream === true;
  const body = {
    model: profile.modelId,
    messages: messages.map(({ role, content }) => ({ role, content })),
    max_tokens: profile.maxOutput,
    temperature: profile.temperature ?? 1,
    top_p: profile.topP ?? 1,
    frequency_penalty: profile.frequencyPenalty ?? 0,
    presence_penalty: profile.presencePenalty ?? 0,
    ...(stream ? { stream: true } : {}),
    ...(profile.reasoningEffort ? { reasoning_effort: profile.reasoningEffort } : {}),
    ...(profile.verbosity ? { verbosity: profile.verbosity } : {}),
  };
  const parsed = parseProviderUrl(profile.baseUrl);
  await assertAllowedDestination(parsed);
  if (externalSignal?.aborted) throw new ProviderCancelledError();

  const signal = externalSignal ?? new AbortController().signal;
  try {
    let response: Response;
    try {
      response = await fetch(endpoint(parsed.url, 'chat/completions'), {
        method: 'POST',
        headers: {
          Accept: stream ? 'text/event-stream, application/json' : 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'manual',
        signal,
      });
    } catch {
      if (signal.aborted) throw new ProviderCancelledError();
      throw new ProviderConnectionError('本机 Provider 调用失败。');
    }
    if (signal.aborted) throw new ProviderCancelledError();
    if (response.status >= 300 && response.status < 400) {
      throw new ProviderConnectionError('Provider 重定向被拒绝。');
    }
    if (!response.ok) throw new ProviderConnectionError(readErrorStatus(response.status));

    if (stream && response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
      try {
        return await readProviderSse(response, signal, options.onDelta);
      } catch (error) {
        if (signal.aborted) throw new ProviderCancelledError();
        if (error instanceof ProviderStreamProtocolError) {
          throw new ProviderConnectionError(error.message);
        }
        throw error;
      }
    }

    let payload: {
      choices?: Array<{
        finish_reason?: unknown;
        message?: { content?: unknown; refusal?: unknown };
      }>;
    };
    try {
      payload = await readProviderJson(response) as typeof payload;
    } catch (error) {
      if (signal.aborted) throw new ProviderCancelledError();
      throw error;
    }
    if (signal.aborted) throw new ProviderCancelledError();
    const choice = payload.choices?.[0];
    const message = choice?.message;
    const finishReason = mapProviderFinishReason(choice?.finish_reason, message?.refusal);
    const content = message?.content;
    let draft = '';
    if (typeof content === 'string' && content.trim()) {
      draft = content.trim();
    } else if (Array.isArray(content)) {
      draft = content.map((item) => (
        item && typeof item === 'object' && 'text' in item && typeof item.text === 'string' ? item.text : ''
      )).join('').trim();
    }
    if (!draft && !finishReasonAllowsEmptyDraft(finishReason)) {
      throw new ProviderConnectionError('Provider 没有返回可写入正文的文本。');
    }
    if (stream && draft) options.onDelta?.(draft);
    return { draft, finishReason };
  } catch (error) {
    if (signal.aborted) throw new ProviderCancelledError();
    if (error instanceof ProviderInputError || error instanceof ProviderConnectionError) throw error;
    throw new ProviderConnectionError('本机 Provider 调用失败。');
  }
};
