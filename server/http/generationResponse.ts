import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertGenerationExecutable, buildContextPlan, fakeGenerate, normalizeSectionMemoryResponse } from '../domain.ts';
import type { StoryStore } from '../store.ts';
import type { ProviderStore } from '../providers.ts';
import { ProviderCancelledError } from '../providers/errors.ts';
import { readGenerationRequest } from './requests.ts';
import { finishGenerationStream, sendJson, sendRequestError, writeGenerationStreamEvent } from './responses.ts';

export const handleGenerationRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  storyStore: StoryStore,
  providerStore: ProviderStore,
) => {
  let generationSignal: AbortSignal | undefined;
  let streamingGeneration = false;
  try {
    const generationController = new AbortController();
    let generationFinished = false;
    generationSignal = generationController.signal;
    const abortOnClientDisconnect = () => {
      if (!generationFinished && !generationController.signal.aborted) generationController.abort();
    };
    request.once('aborted', abortOnClientDisconnect);
    response.once('close', abortOnClientDisconnect);
    try {
      const body = await readGenerationRequest(request);
      streamingGeneration = body.stream === true;
      if (generationController.signal.aborted) return;
      const book = await storyStore.loadBook(body.bookId);
      if (generationController.signal.aborted) return;
      const limits = await providerStore.getContextLimits(body.providerProfileId);
      if (generationController.signal.aborted) return;
      const plan = buildContextPlan(book, body, limits);
      assertGenerationExecutable(body);
      const emitDelta = streamingGeneration
        ? (delta: string) => {
            if (generationController.signal.aborted || response.destroyed) {
              throw new ProviderCancelledError();
            }
            writeGenerationStreamEvent(response, { type: 'delta', text: delta });
          }
        : undefined;
      const generated = body.providerProfileId
        ? await providerStore.generate(body.providerProfileId, plan.messages, generationController.signal, {
            stream: streamingGeneration,
            onDelta: emitDelta,
          })
        : null;
      if (generationController.signal.aborted) return;
      if (generated !== null) {
        const result = {
          draft: body.generationKind === 'summarize-section'
            && (generated.finishReason === 'stop' || generated.finishReason === 'unknown')
            ? normalizeSectionMemoryResponse(generated.draft)
            : generated.draft,
          finishReason: generated.finishReason,
          sourceSignature: plan.sourceSignature,
        };
        if (streamingGeneration) {
          writeGenerationStreamEvent(response, { type: 'result', result });
          generationFinished = true;
          finishGenerationStream(response);
          return;
        }
        generationFinished = true;
        return sendJson(response, 200, result);
      }
      const fake = fakeGenerate(book, body, limits, plan);
      const result = {
        draft: fake.draft,
        finishReason: 'stop',
        sourceSignature: fake.sourceSignature,
      };
      if (streamingGeneration) {
        if (emitDelta) emitDelta(result.draft);
        writeGenerationStreamEvent(response, { type: 'result', result });
        generationFinished = true;
        finishGenerationStream(response);
        return;
      }
      generationFinished = true;
      return sendJson(response, 200, result);
    } finally {
      generationFinished = true;
      request.off('aborted', abortOnClientDisconnect);
      response.off('close', abortOnClientDisconnect);
    }
  } catch (error) {
    return sendRequestError(response, error, generationSignal, streamingGeneration);
  }
};
