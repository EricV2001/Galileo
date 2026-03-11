import { GALILEO_LMSTUDIO_URL } from './config.js';
import { logger } from '../logger.js';

// -- Types ----------------------------------------------------------------

/** Shape returned by LM Studio's OpenAI-compatible GET /models endpoint. */
interface ModelsResponse {
  data: Array<{ id: string }>;
}

/**
 * Shape returned by LM Studio's management API (GET /api/v0/models).
 * Only the fields we care about are typed.
 */
interface ManagedModel {
  id: string;
  state: string;
}

// -- Constants ------------------------------------------------------------

const TIMEOUT_MS = 5_000;

// -- Helpers --------------------------------------------------------------

/** Fetch with a 5-second timeout. */
async function timedFetch(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// -- Public API -----------------------------------------------------------

/**
 * Probe LM Studio availability.
 *
 * Calls `GET ${GALILEO_LMSTUDIO_URL}/models` and returns `true` when the
 * server responds OK and advertises at least one model.
 */
export async function probeLmStudio(): Promise<boolean> {
  try {
    const res = await timedFetch(`${GALILEO_LMSTUDIO_URL}/models`);
    if (!res.ok) return false;
    const body = (await res.json()) as ModelsResponse;
    return Array.isArray(body.data) && body.data.length > 0;
  } catch (err) {
    logger.debug({ err }, 'probeLmStudio: LM Studio unreachable');
    return false;
  }
}

/**
 * List model IDs served by LM Studio (OpenAI-compatible endpoint).
 *
 * Returns an empty array when LM Studio is unreachable.
 */
export async function listModels(): Promise<string[]> {
  try {
    const res = await timedFetch(`${GALILEO_LMSTUDIO_URL}/models`);
    if (!res.ok) return [];
    const body = (await res.json()) as ModelsResponse;
    if (!Array.isArray(body.data)) return [];
    return body.data.map((m) => m.id);
  } catch (err) {
    logger.debug({ err }, 'listModels: failed to list LM Studio models');
    return [];
  }
}

/**
 * Check whether a specific model is currently *loaded* in LM Studio.
 *
 * Uses the management API at `/api/v0/models` (note: different from the
 * OpenAI-compatible `/v1/models`). The management API may not always be
 * available, so any error returns `false`.
 */
export async function isModelLoaded(modelId: string): Promise<boolean> {
  try {
    // The config URL ends with /v1 — strip it to reach the management API.
    const baseUrl = GALILEO_LMSTUDIO_URL.replace('/v1', '');
    const res = await timedFetch(`${baseUrl}/api/v0/models`);
    if (!res.ok) return false;
    const models = (await res.json()) as ManagedModel[];
    return models.some((m) => m.id === modelId && m.state === 'loaded');
  } catch (err) {
    logger.debug({ err }, 'isModelLoaded: management API unavailable');
    return false;
  }
}
