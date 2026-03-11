/**
 * Public API for Galileo memory.
 *
 * This is the single import surface for src/index.ts — it ties together the
 * graphiti client, entity extractor, and config into three simple operations:
 *   - recallMemory(query)   — enrich a prompt with relevant past context
 *   - storeMemory(prompt, response, groupFolder) — persist a conversation turn
 *   - isGalileoMemoryEnabled() — gate check
 */

import { isGalileoMemoryEnabled as _isEnabled } from './config.js';
import {
  initGraphiti,
  closeGraphiti,
  hybridSearch,
  storeEpisode,
} from './graphiti-client.js';
import { extractAndStoreEntities } from './entity-extractor.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Re-export for convenience — index.ts imports everything from one place
// ---------------------------------------------------------------------------

export function isGalileoMemoryEnabled(): boolean {
  return _isEnabled();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialise the Galileo memory subsystem.
 * Should be called once at startup (after config is loaded).
 */
export async function initGalileoMemory(): Promise<void> {
  await initGraphiti();
}

/**
 * Shut down the Galileo memory subsystem.
 * Should be called at process exit to release Neo4j connections.
 */
export async function closeGalileoMemory(): Promise<void> {
  await closeGraphiti();
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

/**
 * Search the knowledge graph for facts relevant to `query`.
 *
 * Returns a Markdown block matching the Galileo1 Python format:
 *
 *   ## Relevant Memory
 *   - fact 1
 *   - fact 2
 *
 * Returns an empty string when there are no results or on error.
 */
export async function recallMemory(query: string): Promise<string> {
  try {
    const results = await hybridSearch(query);

    if (results.length === 0) {
      return '';
    }

    const bullets = results.map((r) => `- ${r.fact}`).join('\n');
    return `## Relevant Memory\n${bullets}`;
  } catch (err) {
    logger.warn({ err }, 'recallMemory failed — returning empty string');
    return '';
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Persist a conversation turn (prompt + response) as an episode, then
 * kick off async entity extraction.
 *
 * The episode write is awaited so we get the episodeId.  Entity extraction
 * runs fire-and-forget — it will not block the caller.
 */
export async function storeMemory(
  prompt: string,
  response: string,
  groupFolder: string,
): Promise<void> {
  const body = `User: ${prompt}\n\nAssistant: ${response}`;

  let episodeId: string;
  try {
    episodeId = await storeEpisode(body, groupFolder);
  } catch (err) {
    logger.warn({ err, groupFolder }, 'storeMemory failed to store episode');
    return;
  }

  // Fire-and-forget: entity extraction runs in the background.
  extractAndStoreEntities(body, episodeId).catch((err) =>
    logger.warn({ err, episodeId }, 'Background entity extraction failed'),
  );
}
