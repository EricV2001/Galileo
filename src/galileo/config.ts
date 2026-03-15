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
  'GALILEO_MAX_LOCAL_CONTEXT_MESSAGES',
  'GALILEO_LOCAL_SYSTEM_PROMPT',
  'GALILEO_LOCAL_MAX_TOKENS',
] as const;

const envConfig = readEnvFile([...GALILEO_KEYS]);

function env(key: string): string | undefined {
  return process.env[key] || envConfig[key] || undefined;
}

// -- Exported constants ---------------------------------------------------

const rawMode = env('GALILEO_ROUTING_MODE') || 'CLAUDE_ONLY';
const validModes: GalileoRoutingMode[] = ['LOCAL_FIRST', 'LOCAL_ONLY', 'CLAUDE_ONLY'];
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

export const GALILEO_MAX_LOCAL_CONTEXT_MESSAGES = parseInt(
  env('GALILEO_MAX_LOCAL_CONTEXT_MESSAGES') || '40',
  10,
);

const DEFAULT_LOCAL_SYSTEM_PROMPT = `You are Galileo, a capable AI assistant running on local hardware. You help with a wide range of tasks including web scraping, data collection, code analysis, file management, and research.

Guidelines:
- Be concise and direct. Skip unnecessary preamble.
- When given a task, execute it step by step. Report results clearly.
- If a task is ambiguous, make reasonable assumptions and proceed rather than asking for clarification.
- For scraping or data tasks: extract structured data, handle errors gracefully, and save results.
- For code tasks: read carefully before modifying, prefer minimal targeted changes.
- If you encounter an error, try an alternative approach before giving up.`;

export const GALILEO_LOCAL_SYSTEM_PROMPT =
  env('GALILEO_LOCAL_SYSTEM_PROMPT') || DEFAULT_LOCAL_SYSTEM_PROMPT;

export const GALILEO_LOCAL_MAX_TOKENS = parseInt(
  env('GALILEO_LOCAL_MAX_TOKENS') || '16384',
  10,
);

// -- Helpers --------------------------------------------------------------

export function isGalileoMemoryEnabled(): boolean {
  return GALILEO_MEMORY_ENABLED;
}
