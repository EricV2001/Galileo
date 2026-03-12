/**
 * Step: set-routing — Update routing mode for an existing registered group.
 *
 * Usage: npx tsx setup/index.ts --step set-routing --jid <jid> --mode <LOCAL_FIRST|LOCAL_ONLY|CLAUDE_ONLY>
 */
import { STORE_DIR } from '../src/config.ts';
import {
  initDatabase,
  getRegisteredGroup,
  setRegisteredGroup,
} from '../src/db.ts';
import { logger } from '../src/logger.ts';
import { emitStatus } from './status.ts';
import fs from 'fs';

const VALID_MODES = ['LOCAL_FIRST', 'LOCAL_ONLY', 'CLAUDE_ONLY'] as const;
type RoutingMode = (typeof VALID_MODES)[number];

interface SetRoutingArgs {
  jid: string;
  mode: string;
}

function parseArgs(args: string[]): SetRoutingArgs {
  const result: SetRoutingArgs = { jid: '', mode: '' };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--jid':
        result.jid = args[++i] || '';
        break;
      case '--mode':
        result.mode = args[++i] || '';
        break;
    }
  }

  return result;
}

export async function run(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (!parsed.jid || !parsed.mode) {
    emitStatus('SET_ROUTING', {
      STATUS: 'failed',
      ERROR: 'missing_required_args',
      USAGE: 'npx tsx setup/index.ts --step set-routing --jid <jid> --mode <LOCAL_FIRST|LOCAL_ONLY|CLAUDE_ONLY>',
    });
    process.exit(4);
  }

  if (!VALID_MODES.includes(parsed.mode as RoutingMode)) {
    emitStatus('SET_ROUTING', {
      STATUS: 'failed',
      ERROR: `invalid_mode: "${parsed.mode}". Must be one of: ${VALID_MODES.join(', ')}`,
    });
    process.exit(4);
  }

  // Ensure store directory exists
  fs.mkdirSync(STORE_DIR, { recursive: true });

  initDatabase();

  const group = getRegisteredGroup(parsed.jid);
  if (!group) {
    emitStatus('SET_ROUTING', {
      STATUS: 'failed',
      ERROR: `group_not_found: no registered group with JID "${parsed.jid}"`,
    });
    process.exit(4);
  }

  const previousMode = group.routingMode ?? 'default (global)';

  // Update routing mode
  setRegisteredGroup(parsed.jid, {
    ...group,
    routingMode: parsed.mode as RoutingMode,
  });

  logger.info(
    { jid: parsed.jid, previousMode, newMode: parsed.mode },
    'Updated group routing mode',
  );

  emitStatus('SET_ROUTING', {
    JID: parsed.jid,
    NAME: group.name,
    PREVIOUS_MODE: previousMode,
    NEW_MODE: parsed.mode,
    STATUS: 'success',
  });
}
