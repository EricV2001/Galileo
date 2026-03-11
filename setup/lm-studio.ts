/**
 * Step: lm-studio — Probe LM Studio API and verify available models.
 */
import { readEnvFile } from '../src/env.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

const GALILEO_KEYS = ['GALILEO_LMSTUDIO_URL'];

interface LMStudioModel {
  id: string;
}

interface LMStudioModelsResponse {
  data: LMStudioModel[];
}

export async function run(_args: string[]): Promise<void> {
  const envConfig = readEnvFile([...GALILEO_KEYS]);
  const url =
    process.env.GALILEO_LMSTUDIO_URL ||
    envConfig.GALILEO_LMSTUDIO_URL ||
    'http://localhost:1234/v1';

  logger.info({ url }, 'Probing LM Studio');

  try {
    const response = await fetch(`${url}/models`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const body = (await response.json()) as LMStudioModelsResponse;
    const models = body.data ?? [];
    const modelIds = models.map((m) => m.id);
    const displayList = modelIds.slice(0, 5).join(', ');

    logger.info({ count: modelIds.length }, 'LM Studio models found');

    emitStatus('LM_STUDIO', {
      STATUS: 'success',
      URL: url,
      MODELS_FOUND: modelIds.length,
      MODEL_LIST: displayList || '(none)',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'LM Studio probe failed');
    emitStatus('LM_STUDIO', {
      STATUS: 'failed',
      URL: url,
      MODELS_FOUND: 0,
      MODEL_LIST: '',
      ERROR: message,
    });
  }
}
