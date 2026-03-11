/**
 * Embedding generation via LM Studio's OpenAI-compatible endpoint.
 *
 * Uses nomic-embed-text which requires a prefix on every input:
 *   "search_document: <text>"  for indexing
 *   "search_query: <text>"     for searching
 */

import { GALILEO_LMSTUDIO_URL, GALILEO_MODEL_EMBEDDING } from './config.js';
import { logger } from '../logger.js';

/** OpenAI-compatible embedding response shape. */
interface EmbeddingResponseItem {
  embedding: number[];
  index: number;
}

interface EmbeddingResponse {
  data: EmbeddingResponseItem[];
}

/**
 * Generate vector embeddings for one or more texts via LM Studio.
 *
 * @param texts   Strings to embed.
 * @param prefix  `"search_document"` when indexing, `"search_query"` when searching.
 * @returns       One embedding (number[]) per input text, in the same order.
 *                Returns empty arrays on failure so callers don't crash.
 */
export async function embed(
  texts: string[],
  prefix: 'search_document' | 'search_query',
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const input = texts.map((t) => `${prefix}: ${t}`);

  try {
    const res = await fetch(`${GALILEO_LMSTUDIO_URL}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GALILEO_MODEL_EMBEDDING,
        input,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      logger.warn({ status: res.status, body }, 'Embedding request failed');
      return texts.map(() => []);
    }

    const json = (await res.json()) as EmbeddingResponse;

    // Return embeddings sorted by the index field so order matches input.
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  } catch (err) {
    logger.warn({ err }, 'Embedding request error');
    return texts.map(() => []);
  }
}
