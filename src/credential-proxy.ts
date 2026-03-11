/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 */
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { GALILEO_LMSTUDIO_URL } from './galileo/config.js';
import {
  translateRequest,
  translateResponse,
  createStreamTranslator,
} from './galileo/api-translator.js';
import {
  shouldRouteLocal,
  shouldFallbackToClaude,
  getRoutingMode,
} from './galileo/router.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  // ------------------------------------------------------------------
  // Helper: forward a request to the Anthropic API with credential
  // injection. This is the existing behaviour, extracted so it can be
  // called both from the normal path and from the local-route fallback.
  // ------------------------------------------------------------------
  function forwardToAnthropic(
    body: Buffer,
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
    const headers: Record<string, string | number | string[] | undefined> = {
      ...(req.headers as Record<string, string>),
      host: upstreamUrl.host,
      'content-length': body.length,
    };

    // Strip hop-by-hop headers that must not be forwarded by proxies
    delete headers['connection'];
    delete headers['keep-alive'];
    delete headers['transfer-encoding'];

    if (authMode === 'api-key') {
      // API key mode: inject x-api-key on every request
      delete headers['x-api-key'];
      headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
    } else {
      // OAuth mode: replace placeholder Bearer token with the real one
      // only when the container actually sends an Authorization header
      // (exchange request + auth probes). Post-exchange requests use
      // x-api-key only, so they pass through without token injection.
      if (headers['authorization']) {
        delete headers['authorization'];
        if (oauthToken) {
          headers['authorization'] = `Bearer ${oauthToken}`;
        }
      }
    }

    const upstream = makeRequest(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || (isHttps ? 443 : 80),
        path: req.url,
        method: req.method,
        headers,
      } as RequestOptions,
      (upRes) => {
        res.writeHead(upRes.statusCode!, upRes.headers);
        upRes.pipe(res);
      },
    );

    upstream.on('error', (err) => {
      logger.error(
        { err, url: req.url },
        'Credential proxy upstream error',
      );
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad Gateway');
      }
    });

    upstream.write(body);
    upstream.end();
  }

  // ------------------------------------------------------------------
  // Helper: route a /v1/messages request to LM Studio with API format
  // translation. Throws on failure so the caller can decide whether to
  // fall back to Anthropic.
  // ------------------------------------------------------------------
  async function handleLocalRoute(
    body: Buffer,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const anthropicBody = JSON.parse(body.toString());
    const { body: openaiBody } = translateRequest(anthropicBody);
    const targetUrl = `${GALILEO_LMSTUDIO_URL}/chat/completions`;

    if (anthropicBody.stream) {
      // Streaming: forward and translate SSE chunks
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(openaiBody),
      });

      if (!response.ok || !response.body) {
        throw new Error(`LM Studio returned ${response.status}`);
      }

      // Set up SSE response headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const translator = createStreamTranslator();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Read streaming response, translate chunks, forward to client
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const events = translator(line);
          for (const event of events) {
            res.write(event + '\n\n');
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const events = translator(buffer);
        for (const event of events) {
          res.write(event + '\n\n');
        }
      }

      res.end();
    } else {
      // Non-streaming: translate request, forward, translate response
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(openaiBody),
      });

      if (!response.ok) {
        throw new Error(`LM Studio returned ${response.status}`);
      }

      const openaiResponse = await response.json();
      const anthropicResponse = translateResponse(openaiResponse);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(anthropicResponse));
    }
  }

  // ------------------------------------------------------------------
  // Server
  // ------------------------------------------------------------------
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);

        // Galileo: route /v1/messages to local model if configured
        if (req.url?.startsWith('/v1/messages') && shouldRouteLocal()) {
          handleLocalRoute(body, req, res).catch((err) => {
            logger.warn({ err }, 'Local route failed');
            if (shouldFallbackToClaude()) {
              // Fall through to existing Anthropic forwarding
              forwardToAnthropic(body, req, res);
            } else {
              if (!res.headersSent) {
                res.writeHead(502);
                res.end(JSON.stringify({ error: 'Local model unavailable' }));
              }
            }
          });
          return; // Don't fall through to Anthropic forwarding
        }

        // Default path: forward to Anthropic with credential injection
        forwardToAnthropic(body, req, res);
      });
    });

    server.listen(port, host, () => {
      logger.info(
        { port, host, authMode, routingMode: getRoutingMode() },
        'Credential proxy started',
      );
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
