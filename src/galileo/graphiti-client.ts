import crypto from 'node:crypto';

/**
 * Neo4j client for the Graphiti knowledge graph.
 *
 * Manages episodes (conversation exchanges) and entities (people, concepts,
 * facts), and provides hybrid search across three channels:
 *   1. Vector similarity  (cosine, 768-dim nomic-embed-text)
 *   2. Full-text / BM25   (Lucene under the hood)
 *   3. Graph traversal     (entity -> RELATES_TO -> episode)
 *
 * Results are deduplicated and re-ranked by temporal decay before returning.
 */

import neo4j, { Driver, Session } from 'neo4j-driver';
import {
  GALILEO_NEO4J_URI,
  GALILEO_NEO4J_USER,
  GALILEO_NEO4J_PASSWORD,
  GALILEO_MAX_RECALL_RESULTS,
  GALILEO_DECAY_HALF_LIFE_DAYS,
} from './config.js';
import { embed } from './embeddings.js';
import { rerankByDecay } from './decay.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let driver: Driver | null = null;

function getDriver(): Driver {
  if (!driver) {
    throw new Error('Graphiti not initialised — call initGraphiti() first');
  }
  return driver;
}

function getSession(): Session {
  return getDriver().session();
}

// ---------------------------------------------------------------------------
// Schema (idempotent — safe on every startup)
// ---------------------------------------------------------------------------

const SCHEMA_STATEMENTS = [
  `CREATE FULLTEXT INDEX episode_search IF NOT EXISTS
   FOR (e:Episode) ON EACH [e.episode_body]`,

  `CREATE FULLTEXT INDEX entity_search IF NOT EXISTS
   FOR (e:Entity) ON EACH [e.name, e.summary]`,

  `CREATE VECTOR INDEX episode_embedding IF NOT EXISTS
   FOR (e:Episode) ON e.embedding
   OPTIONS { indexConfig: {
     \`vector.dimensions\`: 768,
     \`vector.similarity_function\`: 'cosine'
   }}`,

  `CREATE VECTOR INDEX entity_embedding IF NOT EXISTS
   FOR (e:Entity) ON e.embedding
   OPTIONS { indexConfig: {
     \`vector.dimensions\`: 768,
     \`vector.similarity_function\`: 'cosine'
   }}`,
];

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Connect to Neo4j and ensure all required indices exist.
 */
export async function initGraphiti(): Promise<void> {
  driver = neo4j.driver(
    GALILEO_NEO4J_URI,
    neo4j.auth.basic(GALILEO_NEO4J_USER, GALILEO_NEO4J_PASSWORD),
  );

  // Verify connectivity early so we surface config errors at startup.
  await driver.verifyConnectivity();
  logger.info({ uri: GALILEO_NEO4J_URI }, 'Connected to Neo4j');

  const session = getSession();
  try {
    for (const stmt of SCHEMA_STATEMENTS) {
      await session.run(stmt);
    }
    logger.info('Graphiti schema indices ensured');
  } finally {
    await session.close();
  }
}

/**
 * Close the Neo4j driver and release all pooled connections.
 */
export async function closeGraphiti(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
    logger.info('Neo4j driver closed');
  }
}

// ---------------------------------------------------------------------------
// Episode storage
// ---------------------------------------------------------------------------

/**
 * Store a conversation exchange as an Episode node.
 *
 * @returns The UUID of the created episode.
 */
export async function storeEpisode(
  body: string,
  groupFolder: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const embeddings = await embed([body], 'search_document');
  const embedding = embeddings[0] ?? [];

  const session = getSession();
  try {
    await session.run(
      `CREATE (e:Episode {
         id: $id,
         episode_body: $body,
         group_folder: $groupFolder,
         created_at: $createdAt,
         embedding: $embedding
       })`,
      { id, body, groupFolder, createdAt, embedding },
    );
    logger.debug({ id, groupFolder }, 'Stored episode');
    return id;
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Entity storage
// ---------------------------------------------------------------------------

/**
 * Store (or update) an Entity node and link it to an episode.
 *
 * Uses MERGE on the entity name to avoid duplicates — if the entity already
 * exists its summary and embedding are updated.
 *
 * @returns The UUID of the entity (new or existing).
 */
export async function storeEntity(
  name: string,
  entityType: string,
  summary: string,
  episodeId: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const embeddings = await embed([summary], 'search_document');
  const embedding = embeddings[0] ?? [];

  const session = getSession();
  try {
    const result = await session.run(
      `MERGE (ent:Entity { name: $name })
       ON CREATE SET
         ent.id          = $id,
         ent.entity_type = $entityType,
         ent.summary     = $summary,
         ent.created_at  = $createdAt,
         ent.embedding   = $embedding
       ON MATCH SET
         ent.summary   = $summary,
         ent.embedding = $embedding
       WITH ent
       MATCH (ep:Episode { id: $episodeId })
       MERGE (ent)-[:RELATES_TO]->(ep)
       RETURN ent.id AS entityId`,
      { id, name, entityType, summary, createdAt, embedding, episodeId },
    );
    // If the entity already existed, return its persisted id.
    const entityId = result.records[0]?.get('entityId') as string;
    logger.debug({ entityId, name }, 'Stored entity');
    return entityId;
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Hybrid search
// ---------------------------------------------------------------------------

interface SearchHit {
  fact: string;
  created_at: string | null;
  score: number;
}

/**
 * Run a search query against the three search channels and return
 * deduplicated, decay-ranked results.
 */
async function vectorSearch(
  queryEmbedding: number[],
  limit: number,
): Promise<SearchHit[]> {
  const session = getSession();
  try {
    const result = await session.run(
      `CALL db.index.vector.queryNodes('episode_embedding', $limit, $queryEmbedding)
       YIELD node, score
       RETURN node.episode_body AS fact, node.created_at AS created_at, score`,
      { limit: neo4j.int(limit), queryEmbedding },
    );
    return result.records.map((r) => ({
      fact: r.get('fact') as string,
      created_at: r.get('created_at') as string | null,
      score: r.get('score') as number,
    }));
  } catch (err) {
    logger.debug({ err }, 'Vector search failed (index may be empty)');
    return [];
  } finally {
    await session.close();
  }
}

async function fulltextSearch(
  query: string,
  limit: number,
): Promise<SearchHit[]> {
  const session = getSession();
  try {
    const result = await session.run(
      `CALL db.index.fulltext.queryNodes('episode_search', $query)
       YIELD node, score
       RETURN node.episode_body AS fact, node.created_at AS created_at, score
       LIMIT $limit`,
      { query, limit: neo4j.int(limit) },
    );
    return result.records.map((r) => ({
      fact: r.get('fact') as string,
      created_at: r.get('created_at') as string | null,
      score: r.get('score') as number,
    }));
  } catch (err) {
    logger.debug({ err }, 'Fulltext search failed (index may be empty)');
    return [];
  } finally {
    await session.close();
  }
}

async function graphSearch(query: string, limit: number): Promise<SearchHit[]> {
  const session = getSession();
  try {
    const result = await session.run(
      `CALL db.index.fulltext.queryNodes('entity_search', $query)
       YIELD node, score
       MATCH (node)-[:RELATES_TO]->(e:Episode)
       RETURN e.episode_body AS fact, e.created_at AS created_at, score
       LIMIT $limit`,
      { query, limit: neo4j.int(limit) },
    );
    return result.records.map((r) => ({
      fact: r.get('fact') as string,
      created_at: r.get('created_at') as string | null,
      score: r.get('score') as number,
    }));
  } catch (err) {
    logger.debug({ err }, 'Graph search failed (index may be empty)');
    return [];
  } finally {
    await session.close();
  }
}

/**
 * Hybrid search across vector, full-text, and graph channels.
 *
 * Results are deduplicated (keeping the highest score per unique fact),
 * re-ranked by temporal decay, and trimmed to `maxResults`.
 */
export async function hybridSearch(
  query: string,
  maxResults: number = GALILEO_MAX_RECALL_RESULTS,
): Promise<Array<{ fact: string; created_at: string | null }>> {
  // Embed the query for vector search.
  const queryEmbeddings = await embed([query], 'search_query');
  const queryEmbedding = queryEmbeddings[0] ?? [];

  // Fetch more candidates per channel so we have room after deduplication.
  const perChannel = maxResults * 3;

  // Run all three channels in parallel.
  const [vectorHits, fulltextHits, graphHits] = await Promise.all([
    vectorSearch(queryEmbedding, perChannel),
    fulltextSearch(query, perChannel),
    graphSearch(query, perChannel),
  ]);

  // Merge and deduplicate — keep the highest score per unique fact.
  const merged = new Map<string, SearchHit>();
  for (const hit of [...vectorHits, ...fulltextHits, ...graphHits]) {
    const existing = merged.get(hit.fact);
    if (!existing || hit.score > existing.score) {
      merged.set(hit.fact, hit);
    }
  }

  // Sort by score descending so rerankByDecay receives them in rank order.
  const sorted = [...merged.values()].sort((a, b) => b.score - a.score);

  // Re-rank by temporal decay and trim.
  const reranked = rerankByDecay(sorted, GALILEO_DECAY_HALF_LIFE_DAYS);
  return reranked.slice(0, maxResults).map(({ fact, created_at }) => ({
    fact,
    created_at,
  }));
}
