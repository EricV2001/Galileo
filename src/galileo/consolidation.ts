/**
 * Obsidian integration — nightly consolidation, weekly synthesis, entity sync.
 *
 * Queries Neo4j for recent episodes, calls Qwen 27B via LM Studio for
 * summarisation, stores consolidation episodes back to the graph, and writes
 * notes to the Obsidian vault.
 */

import neo4j, { Driver } from 'neo4j-driver';
import {
  GALILEO_NEO4J_URI,
  GALILEO_NEO4J_USER,
  GALILEO_NEO4J_PASSWORD,
  GALILEO_LMSTUDIO_URL,
  GALILEO_MODEL_GENERAL,
  GALILEO_OBSIDIAN_VAULT_PATH,
} from './config.js';
import {
  writeDigestNote,
  writeSynthesisNote,
  writeEntityNote,
} from './obsidian-writer.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const CONSOLIDATION_PROMPT = `You are reviewing Galileo's heartbeat logs from the past 24 hours.
Extract only durable, actionable information. Be concise — prefer bullet points of 10 words or less.

For each category, list 1-5 bullet points. Omit categories that have nothing relevant.

## Decisions
(decisions Eric made or committed to)

## Preferences
(how Eric likes things done, communication style, tool choices)

## Insights
(observations, connections, things worth remembering long-term)

## Action Items
(concrete next steps identified)

If the logs contain only routine acknowledgements with no substance, reply with exactly:
No significant content today.`;

const SYNTHESIS_PROMPT = `You are Galileo's knowledge synthesizer. Review the week's heartbeat logs
and daily digests. Surface insights Eric might not have noticed — connections between separate
conversations, emerging patterns, ideas worth developing.

Write in second person ("you've been..."). Be specific; avoid generic observations.
Do not repeat what was obvious in individual digests.

Format your response with these headings (omit any that have nothing relevant):

## Cross-conversation connections

## Emerging patterns

## Ideas worth developing

## Questions to explore`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openDriver(): Driver {
  return neo4j.driver(
    GALILEO_NEO4J_URI,
    neo4j.auth.basic(GALILEO_NEO4J_USER, GALILEO_NEO4J_PASSWORD),
  );
}

async function callLmStudio(
  systemPrompt: string,
  userContent: string,
  maxTokens: number = 1024,
): Promise<string> {
  const url = `${GALILEO_LMSTUDIO_URL}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GALILEO_MODEL_GENERAL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LM Studio returned ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

function isoWeek(date: Date): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// consolidateDaily
// ---------------------------------------------------------------------------

/**
 * Nightly consolidation — queries recent episodes from Neo4j, summarises them
 * via Qwen 27B, stores a consolidation episode, and optionally writes an
 * Obsidian digest note.
 */
export async function consolidateDaily(hours: number = 25): Promise<void> {
  const driver = openDriver();
  try {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (e:Episode)
         WHERE e.created_at >= datetime() - duration({hours: $hours})
           AND NOT e.source_description STARTS WITH 'nightly consolidation'
         RETURN e.name AS name, e.episode_body AS body, e.created_at AS created_at
         ORDER BY e.created_at ASC`,
        { hours: neo4j.int(hours) },
      );

      if (result.records.length === 0) {
        logger.info('consolidateDaily: no recent episodes — skipping');
        return;
      }

      // Format episodes into a single text block
      const episodeText = result.records
        .map((r) => {
          const ts = r.get('created_at')?.toString() ?? '';
          const body = r.get('body') ?? '';
          return `[${ts}]\n${body}`;
        })
        .join('\n\n---\n\n');

      logger.info(
        { count: result.records.length },
        'consolidateDaily: summarising episodes',
      );

      const summary = await callLmStudio(CONSOLIDATION_PROMPT, episodeText);

      if (summary === 'No significant content today.') {
        logger.info('consolidateDaily: no significant content — skipping');
        return;
      }

      // Store consolidation episode
      const today = new Date().toISOString().slice(0, 10);
      await session.run(
        `CREATE (e:Episode {
           name: $name,
           episode_body: $body,
           source_description: $source,
           created_at: datetime()
         })`,
        {
          name: `consolidation-${today}`,
          body: summary,
          source: `nightly consolidation ${today}`,
        },
      );

      logger.info({ date: today }, 'consolidateDaily: episode stored');

      // Write Obsidian note if configured
      if (GALILEO_OBSIDIAN_VAULT_PATH) {
        writeDigestNote(GALILEO_OBSIDIAN_VAULT_PATH, today, summary, result.records.length);
        logger.info('consolidateDaily: digest note written');
      }
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

// ---------------------------------------------------------------------------
// synthesizeWeekly
// ---------------------------------------------------------------------------

/**
 * Weekly synthesis — reviews the past week's episodes, identifies top entities,
 * and produces a cross-conversation synthesis via Qwen 27B.
 */
export async function synthesizeWeekly(days: number = 7): Promise<void> {
  const driver = openDriver();
  try {
    const session = driver.session();
    try {
      // Fetch episodes from the last N days
      const episodeResult = await session.run(
        `MATCH (e:Episode)
         WHERE e.created_at >= datetime() - duration({days: $days})
         RETURN e.episode_body AS body, e.created_at AS created_at, e.source_description AS source
         ORDER BY e.created_at ASC`,
        { days: neo4j.int(days) },
      );

      if (episodeResult.records.length === 0) {
        logger.info('synthesizeWeekly: no episodes in range — skipping');
        return;
      }

      // Fetch top 10 most-connected entities
      const entityResult = await session.run(
        `MATCH (e:Entity)-[r:RELATES_TO]->(other:Entity)
         RETURN e.name AS name, e.summary AS summary, count(r) AS degree
         ORDER BY degree DESC LIMIT 10`,
      );

      // Build anchor text from top entities
      const anchorLines = entityResult.records.map((r) => {
        const name = r.get('name') ?? 'unknown';
        const summary = r.get('summary') ?? '';
        const degree = r.get('degree')?.toNumber?.() ?? r.get('degree') ?? 0;
        return `- **${name}** (${degree} connections): ${summary}`;
      });
      const anchorText =
        anchorLines.length > 0
          ? `## Key entities this week\n${anchorLines.join('\n')}`
          : '';

      // Build episode text
      const episodeText = episodeResult.records
        .map((r) => {
          const ts = r.get('created_at')?.toString() ?? '';
          const source = r.get('source') ?? '';
          const body = r.get('body') ?? '';
          return `[${ts}] (${source})\n${body}`;
        })
        .join('\n\n---\n\n');

      const userContent = anchorText
        ? `${anchorText}\n\n---\n\n${episodeText}`
        : episodeText;

      logger.info(
        {
          episodes: episodeResult.records.length,
          entities: entityResult.records.length,
        },
        'synthesizeWeekly: generating synthesis',
      );

      const synthesis = await callLmStudio(
        SYNTHESIS_PROMPT,
        userContent,
        2048,
      );

      // Write Obsidian note if configured
      if (GALILEO_OBSIDIAN_VAULT_PATH) {
        const now = new Date();
        const week = isoWeek(now);
        const endDate = now.toISOString().slice(0, 10);
        const startDate = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
        writeSynthesisNote(
          GALILEO_OBSIDIAN_VAULT_PATH,
          week,
          `${startDate} – ${endDate}`,
          synthesis,
          episodeResult.records.length,
        );
        logger.info({ week }, 'synthesizeWeekly: synthesis note written');
      }
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

// ---------------------------------------------------------------------------
// syncEntities
// ---------------------------------------------------------------------------

/**
 * Entity sync — exports all entities and their relationships from Neo4j to
 * individual Obsidian notes with wiki-link cross-references.
 */
export async function syncEntities(): Promise<void> {
  if (!GALILEO_OBSIDIAN_VAULT_PATH) {
    logger.info('syncEntities: GALILEO_OBSIDIAN_VAULT_PATH not set — skipping');
    return;
  }

  const driver = openDriver();
  try {
    const session = driver.session();
    try {
      // Fetch all entities
      const entityResult = await session.run(
        `MATCH (e:Entity)
         RETURN e.name AS name, e.entity_type AS type, e.summary AS summary, e.created_at AS created_at`,
      );

      // Fetch all edges
      const edgeResult = await session.run(
        `MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity)
         RETURN a.name AS from_entity, b.name AS to_entity, r.fact AS fact`,
      );

      // Build adjacency map: entity name -> list of { relatedName, fact }
      const adjacency = new Map<
        string,
        Array<{ relatedName: string; fact: string }>
      >();
      for (const r of edgeResult.records) {
        const from = r.get('from_entity') as string;
        const to = r.get('to_entity') as string;
        const fact = (r.get('fact') as string) ?? '';

        if (!adjacency.has(from)) adjacency.set(from, []);
        adjacency.get(from)!.push({ relatedName: to, fact });

        // Also record the reverse direction so the entity note shows all links
        if (!adjacency.has(to)) adjacency.set(to, []);
        adjacency.get(to)!.push({ relatedName: from, fact });
      }

      let written = 0;
      let skipped = 0;

      for (const record of entityResult.records) {
        const name = record.get('name') as string | null;
        if (!name) {
          skipped++;
          continue;
        }

        const type = (record.get('type') as string) ?? 'unknown';
        const summary = (record.get('summary') as string) ?? '';
        const relations = adjacency.get(name) ?? [];

        const createdAt = (record.get('created_at')?.toString() as string) ?? '';
        writeEntityNote(
          GALILEO_OBSIDIAN_VAULT_PATH,
          { name, type, summary, createdAt },
          relations,
        );
        written++;
      }

      logger.info(
        { written, skipped },
        'syncEntities: entity notes synced to Obsidian',
      );
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}
