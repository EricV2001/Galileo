import { GALILEO_ROUTING_MODE, GalileoRoutingMode } from './config.js';

// -- Public API -----------------------------------------------------------

/**
 * Should the credential proxy attempt to route requests to LM Studio?
 *
 * True for `LOCAL_FIRST` (try local, fall back to Claude) and `LOCAL_ONLY`
 * (local or fail). False for `CLAUDE_ONLY`.
 */
export function shouldRouteLocal(): boolean {
  return (
    GALILEO_ROUTING_MODE === 'LOCAL_FIRST' ||
    GALILEO_ROUTING_MODE === 'LOCAL_ONLY'
  );
}

/**
 * Should the credential proxy fall back to Claude when LM Studio is
 * unavailable or returns an error?
 *
 * Only true for `LOCAL_FIRST`. `LOCAL_ONLY` will let the request fail,
 * and `CLAUDE_ONLY` never touches local models.
 */
export function shouldFallbackToClaude(): boolean {
  return GALILEO_ROUTING_MODE === 'LOCAL_FIRST';
}

/**
 * Return the current routing mode for logging / display.
 */
export function getRoutingMode(): GalileoRoutingMode {
  return GALILEO_ROUTING_MODE;
}
