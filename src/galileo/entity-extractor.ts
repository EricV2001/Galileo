/**
 * Entity extraction via Qwen 9B (LM Studio).
 *
 * Sends conversation text to the local extraction model, parses the returned
 * JSON into entities, and stores each one in Neo4j via storeEntity().
 *
 * This module is called fire-and-forget after each episode is stored — it
 * must never throw.
 */

import { GALILEO_LMSTUDIO_URL, GALILEO_MODEL_EXTRACTION } from './config.js';
import { storeEntity } from './graphiti-client.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractedEntity {
  name: string;
  type: string;
  summary: string;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
}

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'Extract entities from the following conversation. ' +
  'Return ONLY valid JSON, no markdown fences, no explanation. Schema: { "entities": ' +
  '[{ "name": "string", "type": "person|project|concept|tool|event|location|organization", ' +
  '"summary": "one sentence describing this entity in context" }] }';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract entities from `episodeBody` using Qwen 9B and store them in Neo4j.
 *
 * Errors are logged but never thrown — the caller treats this as
 * fire-and-forget.
 */
export async function extractAndStoreEntities(
  episodeBody: string,
  episodeId: string,
): Promise<void> {
  try {
    // Step 1: Call LM Studio for extraction
    const response = await fetch(`${GALILEO_LMSTUDIO_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GALILEO_MODEL_EXTRACTION,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `/no_think\n${episodeBody}` },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText },
        'Entity extraction request failed',
      );
      return;
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn('Entity extraction returned empty content');
      return;
    }

    // Step 2: Parse the JSON response
    // Strip <think>...</think> tags that some models emit before JSON
    let jsonContent = content;
    const thinkEnd = jsonContent.indexOf('</think>');
    if (thinkEnd !== -1) {
      jsonContent = jsonContent.slice(thinkEnd + '</think>'.length).trim();
    }

    let parsed: ExtractionResult;
    try {
      parsed = JSON.parse(jsonContent) as ExtractionResult;
    } catch {
      logger.warn(
        { content: jsonContent.slice(0, 200) },
        'Failed to parse entity extraction JSON',
      );
      return;
    }

    if (!Array.isArray(parsed.entities)) {
      logger.warn(
        { parsed },
        'Entity extraction result missing entities array',
      );
      return;
    }

    // Step 3: Store entities sequentially to avoid Neo4j write contention
    for (const entity of parsed.entities) {
      if (!entity.name || !entity.type || !entity.summary) {
        logger.debug({ entity }, 'Skipping malformed entity');
        continue;
      }
      await storeEntity(entity.name, entity.type, entity.summary, episodeId);
    }

    logger.debug(
      { episodeId, count: parsed.entities.length },
      'Entity extraction complete',
    );
  } catch (err) {
    // LM Studio down, network error, or any other unexpected failure.
    logger.warn({ err }, 'Entity extraction failed');
  }
}
