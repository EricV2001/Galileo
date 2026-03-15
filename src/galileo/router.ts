import { GALILEO_ROUTING_MODE, GalileoRoutingMode } from './config.js';

const VALID_MODES: GalileoRoutingMode[] = [
  'LOCAL_FIRST',
  'LOCAL_ONLY',
  'CLAUDE_ONLY',
];

// -- Public API -----------------------------------------------------------

/**
 * Should the credential proxy attempt to route requests to LM Studio?
 * Accepts an optional per-request override (from URL path).
 */
export function shouldRouteLocal(mode?: GalileoRoutingMode): boolean {
  const m = mode ?? GALILEO_ROUTING_MODE;
  return m === 'LOCAL_FIRST' || m === 'LOCAL_ONLY';
}

/**
 * Should the credential proxy fall back to Claude when LM Studio fails?
 * Accepts an optional per-request override.
 */
export function shouldFallbackToClaude(mode?: GalileoRoutingMode): boolean {
  const m = mode ?? GALILEO_ROUTING_MODE;
  return m === 'LOCAL_FIRST';
}

/**
 * Return the current global routing mode for logging / display.
 */
export function getRoutingMode(): GalileoRoutingMode {
  return GALILEO_ROUTING_MODE;
}

/**
 * Parse a per-request routing mode from a URL path prefix.
 * URLs like `/route/LOCAL_FIRST/v1/messages` encode the routing mode.
 * Returns the mode and the stripped URL, or undefined if no prefix.
 */
export function parseRoutePrefix(url: string): {
  mode: GalileoRoutingMode | undefined;
  strippedUrl: string;
} {
  const match = url.match(/^\/route\/([A-Z_]+)(\/.*)/);
  if (match && VALID_MODES.includes(match[1] as GalileoRoutingMode)) {
    return { mode: match[1] as GalileoRoutingMode, strippedUrl: match[2] };
  }
  return { mode: undefined, strippedUrl: url };
}
