/**
 * Step: obsidian — Validate vault path and create Galileo subdirectories.
 */
import fs from 'fs';
import path from 'path';

import { readEnvFile } from '../src/env.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

const GALILEO_KEYS = ['GALILEO_OBSIDIAN_VAULT_PATH'];

const GALILEO_DIRS = ['Galileo/Digest', 'Galileo/Entities', 'Galileo/Weekly'];

export async function run(_args: string[]): Promise<void> {
  const envConfig = readEnvFile([...GALILEO_KEYS]);
  const vaultPath =
    process.env.GALILEO_OBSIDIAN_VAULT_PATH ||
    envConfig.GALILEO_OBSIDIAN_VAULT_PATH ||
    '';

  if (!vaultPath) {
    logger.info('No Obsidian vault path configured, skipping');
    emitStatus('OBSIDIAN', {
      STATUS: 'skipped',
      VAULT_PATH: '(not set)',
      DIRS_CREATED: 0,
    });
    return;
  }

  logger.info({ vaultPath }, 'Validating Obsidian vault');

  // Check vault path exists and is a directory
  if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    emitStatus('OBSIDIAN', {
      STATUS: 'failed',
      VAULT_PATH: vaultPath,
      DIRS_CREATED: 0,
      ERROR: `Vault path does not exist or is not a directory: ${vaultPath}`,
    });
    return;
  }

  // Check write permissions
  const testFile = path.join(vaultPath, '.galileo-write-test');
  try {
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitStatus('OBSIDIAN', {
      STATUS: 'failed',
      VAULT_PATH: vaultPath,
      DIRS_CREATED: 0,
      ERROR: `Vault path is not writable: ${message}`,
    });
    return;
  }

  // Create Galileo subdirectories
  let dirsCreated = 0;
  for (const dir of GALILEO_DIRS) {
    const fullPath = path.join(vaultPath, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      dirsCreated++;
      logger.info({ dir: fullPath }, 'Created directory');
    }
  }

  emitStatus('OBSIDIAN', {
    STATUS: 'success',
    VAULT_PATH: vaultPath,
    DIRS_CREATED: dirsCreated,
  });
}
