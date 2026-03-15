import { readEnvFile } from '../env.js';

// -- Types ----------------------------------------------------------------

export type GalileoRoutingMode = 'LOCAL_FIRST' | 'LOCAL_ONLY' | 'CLAUDE_ONLY';

// -- Read .env (does NOT pollute process.env) -----------------------------

const GALILEO_KEYS = [
  'GALILEO_ROUTING_MODE',
  'GALILEO_LMSTUDIO_URL',
  'GALILEO_MODEL_GENERAL',
  'GALILEO_MODEL_EXTRACTION',
  'GALILEO_MODEL_EMBEDDING',
  'GALILEO_MEMORY_ENABLED',
  'GALILEO_NEO4J_URI',
  'GALILEO_NEO4J_USER',
  'GALILEO_NEO4J_PASSWORD',
  'GALILEO_MAX_RECALL_RESULTS',
  'GALILEO_DECAY_HALF_LIFE_DAYS',
  'GALILEO_OBSIDIAN_VAULT_PATH',
  'GALILEO_MAX_LOCAL_ITERATIONS',
] as const;

const envConfig = readEnvFile([...GALILEO_KEYS]);

function env(key: string): string | undefined {
  return process.env[key] || envConfig[key] || undefined;
}

// -- Exported constants ---------------------------------------------------

const rawMode = env('GALILEO_ROUTING_MODE') || 'CLAUDE_ONLY';
const validModes: GalileoRoutingMode[] = [
  'LOCAL_FIRST',
  'LOCAL_ONLY',
  'CLAUDE_ONLY',
];
export const GALILEO_ROUTING_MODE: GalileoRoutingMode = validModes.includes(
  rawMode as GalileoRoutingMode,
)
  ? (rawMode as GalileoRoutingMode)
  : 'CLAUDE_ONLY';

export const GALILEO_LMSTUDIO_URL =
  env('GALILEO_LMSTUDIO_URL') || 'http://localhost:1234/v1';
export const GALILEO_MODEL_GENERAL =
  env('GALILEO_MODEL_GENERAL') || 'qwen3.5-27b';
export const GALILEO_MODEL_EXTRACTION =
  env('GALILEO_MODEL_EXTRACTION') || 'qwen3.5-9b';
export const GALILEO_MODEL_EMBEDDING =
  env('GALILEO_MODEL_EMBEDDING') || 'text-embedding-nomic-embed-text-v1.5@f16';

export const GALILEO_MEMORY_ENABLED =
  (env('GALILEO_MEMORY_ENABLED') || 'false') === 'true';

export const GALILEO_NEO4J_URI =
  env('GALILEO_NEO4J_URI') || 'bolt://localhost:7687';
export const GALILEO_NEO4J_USER = env('GALILEO_NEO4J_USER') || 'neo4j';
export const GALILEO_NEO4J_PASSWORD = env('GALILEO_NEO4J_PASSWORD') || '';

export const GALILEO_MAX_RECALL_RESULTS = parseInt(
  env('GALILEO_MAX_RECALL_RESULTS') || '5',
  10,
);
export const GALILEO_DECAY_HALF_LIFE_DAYS = parseInt(
  env('GALILEO_DECAY_HALF_LIFE_DAYS') || '30',
  10,
);

export const GALILEO_OBSIDIAN_VAULT_PATH =
  env('GALILEO_OBSIDIAN_VAULT_PATH') || '';

export const GALILEO_MAX_LOCAL_ITERATIONS = parseInt(
  env('GALILEO_MAX_LOCAL_ITERATIONS') || '10',
  10,
);

// -- Helpers --------------------------------------------------------------

export function isGalileoMemoryEnabled(): boolean {
  return GALILEO_MEMORY_ENABLED;
}
