/**
 * Entity extraction via Qwen 9B (LM Studio).
 *
 * Sends conversation text to the local extraction model, parses the returned
 * JSON into entities, and stores each one in Neo4j via storeEntity().
 *
 * This module is called fire-and-forget after each episode is stored — it
 * must never throw.
 */

import { ASSISTANT_NAME } from '../config.js';
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

function buildExtractionPrompt(): string {
  return (
    `Extract entities from the following conversation between a user and an AI assistant named "${ASSISTANT_NAME}". ` +
    `Do NOT include "${ASSISTANT_NAME}" itself as an entity. ` +
    'Return ONLY valid JSON, no markdown fences, no explanation, no reasoning. Schema: { "entities": ' +
    '[{ "name": "string", "type": "person|project|concept|tool|event|location|organization", ' +
    '"summary": "one sentence describing this entity in context" }] }'
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cap input length so the 9B model isn't overwhelmed by full context windows. */
const MAX_INPUT_CHARS = 2000;

/**
 * Attempt to repair truncated JSON from the extraction model.
 * The model often produces valid JSON that gets cut off mid-stream.
 * We try to close any open strings, arrays, and objects.
 */
function repairTruncatedJson(raw: string): string {
  // Already valid?
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    // Continue with repair
  }

  let fixed = raw;

  // Close an open string value (odd number of unescaped quotes)
  const quotes = (fixed.match(/(?<!\\)"/g) || []).length;
  if (quotes % 2 !== 0) {
    fixed += '"';
  }

  // Close open arrays and objects by counting unmatched brackets
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  for (let i = 0; i < fixed.length; i++) {
    const ch = fixed[i];
    if (ch === '"' && (i === 0 || fixed[i - 1] !== '\\')) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }

  // Remove trailing comma before closing
  fixed = fixed.replace(/,\s*$/, '');

  // If we're mid-object (after a key's colon with no value), drop the dangling key
  fixed = fixed.replace(/,?\s*"[^"]*"\s*:\s*$/, '');

  for (let i = 0; i < openBrackets; i++) fixed += ']';
  for (let i = 0; i < openBraces; i++) fixed += '}';

  return fixed;
}

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
    // Truncate input — entity extraction only needs the gist, not the full
    // context window. Large inputs cause the 9B model to generate slowly
    // and produce truncated JSON.
    const truncatedBody =
      episodeBody.length > MAX_INPUT_CHARS
        ? episodeBody.slice(-MAX_INPUT_CHARS)
        : episodeBody;

    // Step 1: Call LM Studio for extraction
    const response = await fetch(`${GALILEO_LMSTUDIO_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GALILEO_MODEL_EXTRACTION,
        messages: [
          { role: 'system', content: buildExtractionPrompt() },
          { role: 'user', content: `/no_think\n${truncatedBody}` },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(120_000),
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

    // Strip markdown code fences if present
    jsonContent = jsonContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    let parsed: ExtractionResult;
    try {
      parsed = JSON.parse(jsonContent) as ExtractionResult;
    } catch {
      // Attempt to repair truncated JSON before giving up
      const repaired = repairTruncatedJson(jsonContent);
      try {
        parsed = JSON.parse(repaired) as ExtractionResult;
        logger.info('Entity extraction JSON repaired from truncated response');
      } catch {
        logger.warn(
          { content: jsonContent.slice(0, 200) },
          'Failed to parse entity extraction JSON',
        );
        return;
      }
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

    logger.info(
      { episodeId, count: parsed.entities.length },
      'Entity extraction complete',
    );
  } catch (err) {
    // LM Studio down, network error, or any other unexpected failure.
    logger.warn({ err }, 'Entity extraction failed');
  }
}
