/**
 * Step: neo4j — Verify Neo4j connectivity and create Graphiti schema indices.
 */
import neo4j from 'neo4j-driver';

import { readEnvFile } from '../src/env.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

const GALILEO_KEYS = [
  'GALILEO_NEO4J_URI',
  'GALILEO_NEO4J_USER',
  'GALILEO_NEO4J_PASSWORD',
];

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

export async function run(_args: string[]): Promise<void> {
  const envConfig = readEnvFile([...GALILEO_KEYS]);
  const uri =
    process.env.GALILEO_NEO4J_URI ||
    envConfig.GALILEO_NEO4J_URI ||
    'bolt://localhost:7687';
  const user =
    process.env.GALILEO_NEO4J_USER ||
    envConfig.GALILEO_NEO4J_USER ||
    'neo4j';
  const password =
    process.env.GALILEO_NEO4J_PASSWORD ||
    envConfig.GALILEO_NEO4J_PASSWORD ||
    '';

  logger.info({ uri }, 'Checking Neo4j connectivity');

  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

  try {
    await driver.verifyConnectivity();
    logger.info('Neo4j connectivity verified');

    const session = driver.session();
    try {
      for (const stmt of SCHEMA_STATEMENTS) {
        await session.run(stmt);
      }
      logger.info('Schema indices created');
    } finally {
      await session.close();
    }

    emitStatus('NEO4J', {
      STATUS: 'success',
      NEO4J_URI: uri,
      INDICES_CREATED: SCHEMA_STATEMENTS.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'Neo4j setup failed');
    emitStatus('NEO4J', {
      STATUS: 'failed',
      NEO4J_URI: uri,
      INDICES_CREATED: 0,
      ERROR: message,
    });
  } finally {
    await driver.close();
  }
}
