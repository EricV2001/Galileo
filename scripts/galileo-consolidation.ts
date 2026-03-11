#!/usr/bin/env tsx
/**
 * CLI entry point for Galileo consolidation tasks.
 *
 * Usage:
 *   npx tsx scripts/galileo-consolidation.ts daily [--hours 25]
 *   npx tsx scripts/galileo-consolidation.ts weekly [--days 7]
 *   npx tsx scripts/galileo-consolidation.ts entities
 *
 * Scheduled via launchd — see deploy/galileo-*.plist
 */
import { consolidateDaily, synthesizeWeekly, syncEntities } from '../src/galileo/consolidation.js';

const command = process.argv[2];

function parseFlag(flag: string, defaultValue: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultValue;
  const val = parseInt(process.argv[idx + 1], 10);
  return isNaN(val) ? defaultValue : val;
}

async function main(): Promise<void> {
  switch (command) {
    case 'daily': {
      const hours = parseFlag('--hours', 25);
      console.log(`Running daily consolidation (${hours}h look-back)...`);
      await consolidateDaily(hours);
      break;
    }
    case 'weekly': {
      const days = parseFlag('--days', 7);
      console.log(`Running weekly synthesis (${days}d look-back)...`);
      await synthesizeWeekly(days);
      break;
    }
    case 'entities': {
      console.log('Syncing entities to Obsidian...');
      await syncEntities();
      break;
    }
    default:
      console.error('Usage: galileo-consolidation.ts <daily|weekly|entities>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Consolidation failed:', err);
  process.exit(1);
});
