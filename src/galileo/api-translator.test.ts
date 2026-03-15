import { describe, it, expect, vi } from 'vitest';

vi.mock('./config.js', () => ({
  GALILEO_MODEL_GENERAL: 'test-model',
  GALILEO_MAX_LOCAL_CONTEXT_MESSAGES: 40,
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import {
  translateRequest,
  translateResponse,
  createStreamTranslator,
  trimMessages,
} from './api-translator.js';

// ---------------------------------------------------------------------------
// translateRequest
// ---------------------------------------------------------------------------

describe('translateRequest', () => {
  it('translates basic messages with system string', () => {
    const result = translateRequest({
      system: 'You are helpful.',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
      max_tokens: 1024,
    });

    expect(result.body.model).toBe('test-model');
    expect(result.body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
    expect(result.body.max_tokens).toBe(1024);
  });

  it('extracts text from content block arrays in user messages', () => {
    const result = translateRequest({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'block text' }],
        },
      ],
    });

    expect(result.body.messages).toEqual([
      { role: 'user', content: 'block text' },
    ]);
  });

  it('strips tool definitions from requests (local model runs text-only)', () => {
    const result = translateRequest({
      messages: [{ role: 'user', content: 'use the tool' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ],
    });

    expect(result.body.tools).toBeUndefined();
  });

  it('flattens tool_use blocks in assistant messages to plain text', () => {
    const result = translateRequest({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'get_weather',
              input: { city: 'Paris' },
            },
          ],
        },
      ],
    });

    const msg = result.body.messages[0];
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('Let me check.\n[Used tool: get_weather]');
    expect(msg.tool_calls).toBeUndefined();
  });

  it('flattens tool_result blocks to plain text summaries', () => {
    const result = translateRequest({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: 'Sunny, 22C',
            },
          ],
        },
      ],
    });

    expect(result.body.messages).toEqual([
      { role: 'user', content: '[Tool result: Sunny, 22C]' },
    ]);
  });

  it('returns url, body, and headers', () => {
    const result = translateRequest({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.url).toBe('/v1/chat/completions');
    expect(result.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(result.body).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// translateResponse
// ---------------------------------------------------------------------------

describe('translateResponse', () => {
  it('translates a basic text response', () => {
    const result = translateResponse({
      id: 'chatcmpl-abc',
      choices: [
        {
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    expect(result.id).toBe('msg_chatcmpl-abc');
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }]);
    expect(result.model).toBe('test-model');
  });

  it('translates tool_calls to tool_use content blocks', () => {
    const result = translateResponse({
      id: 'chatcmpl-xyz',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"city":"London"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 12 },
    });

    expect(result.content).toEqual([
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'get_weather',
        input: { city: 'London' },
      },
    ]);
  });

  it('maps finish reasons correctly', () => {
    const stop = translateResponse({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
    });
    expect(stop.stop_reason).toBe('end_turn');

    const toolCalls = translateResponse({
      choices: [{ message: { content: 'x' }, finish_reason: 'tool_calls' }],
    });
    expect(toolCalls.stop_reason).toBe('tool_use');

    const length = translateResponse({
      choices: [{ message: { content: 'x' }, finish_reason: 'length' }],
    });
    expect(length.stop_reason).toBe('max_tokens');
  });

  it('maps usage tokens', () => {
    const result = translateResponse({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 42, completion_tokens: 7 },
    });

    expect(result.usage).toEqual({ input_tokens: 42, output_tokens: 7 });
  });

  it('generates an id with msg_ prefix', () => {
    const result = translateResponse({
      id: 'abc123',
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
    });

    expect(result.id).toMatch(/^msg_/);
  });
});

// ---------------------------------------------------------------------------
// createStreamTranslator
// ---------------------------------------------------------------------------

describe('createStreamTranslator', () => {
  it('emits message_start + content_block_start + content_block_delta on first text chunk', () => {
    const translator = createStreamTranslator();
    const events = translator(
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ delta: { content: 'Hi' }, finish_reason: null }],
      })}`,
    );

    expect(events.length).toBe(3);
    expect(events[0]).toContain('event: message_start');
    expect(events[1]).toContain('event: content_block_start');
    expect(events[2]).toContain('event: content_block_delta');

    // Verify delta payload contains the text.
    const deltaData = JSON.parse(events[2].split('\ndata: ')[1]);
    expect(deltaData.delta.text).toBe('Hi');
  });

  it('emits only content_block_delta on subsequent text chunks', () => {
    const translator = createStreamTranslator();

    // First chunk — sets up state.
    translator(
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ delta: { content: 'Hi' }, finish_reason: null }],
      })}`,
    );

    // Second chunk.
    const events = translator(
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ delta: { content: ' there' }, finish_reason: null }],
      })}`,
    );

    expect(events.length).toBe(1);
    expect(events[0]).toContain('event: content_block_delta');
  });

  it('emits content_block_stop + message_delta + message_stop on finish', () => {
    const translator = createStreamTranslator();

    // Send a text chunk first.
    translator(
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ delta: { content: 'Hello' }, finish_reason: null }],
      })}`,
    );

    // Finish chunk.
    const events = translator(
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ delta: {}, finish_reason: 'stop' }],
      })}`,
    );

    expect(events.length).toBe(3);
    expect(events[0]).toContain('event: content_block_stop');
    expect(events[1]).toContain('event: message_delta');
    expect(events[2]).toContain('event: message_stop');

    const deltaData = JSON.parse(events[1].split('\ndata: ')[1]);
    expect(deltaData.delta.stop_reason).toBe('end_turn');
  });

  it('emits message_stop on [DONE] chunk', () => {
    const translator = createStreamTranslator();

    // First send a text chunk so messageStarted is true.
    translator(
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ delta: { content: 'x' }, finish_reason: null }],
      })}`,
    );

    const events = translator('data: [DONE]');

    // Should close active block + message_delta + message_stop.
    expect(events.some((e) => e.includes('event: message_stop'))).toBe(true);
  });

  it('tracks state across multiple calls', () => {
    const translator = createStreamTranslator();

    // First call — gets message_start.
    const first = translator(
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ delta: { content: 'A' }, finish_reason: null }],
      })}`,
    );
    expect(first.some((e) => e.includes('message_start'))).toBe(true);

    // Second call — no message_start.
    const second = translator(
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ delta: { content: 'B' }, finish_reason: null }],
      })}`,
    );
    expect(second.some((e) => e.includes('message_start'))).toBe(false);

    // Third call — finish.
    const third = translator(
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ delta: {}, finish_reason: 'stop' }],
      })}`,
    );
    expect(third.some((e) => e.includes('message_stop'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// message windowing (trimMessages)
// ---------------------------------------------------------------------------

describe('message windowing', () => {
  /** Helper to create N user/assistant message pairs. */
  function makeMessages(count: number) {
    const msgs: Array<{ role: string; content: string }> = [
      { role: 'system', content: 'You are helpful.' },
    ];
    for (let i = 0; i < count; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}` });
    }
    return msgs;
  }

  it('does not trim messages under the limit', () => {
    const msgs = makeMessages(10); // system + 10 = 11 total
    const result = trimMessages(msgs as any);
    expect(result).toEqual(msgs);
    expect(result.length).toBe(11);
  });

  it('keeps system message + last N messages when over limit', async () => {
    // Override the config mock for this test.
    const config = await import('./config.js');
    const original = config.GALILEO_MAX_LOCAL_CONTEXT_MESSAGES;
    (config as any).GALILEO_MAX_LOCAL_CONTEXT_MESSAGES = 5;

    try {
      const msgs = makeMessages(10); // system + 10 conversation messages
      const result = trimMessages(msgs as any);

      expect(result.length).toBe(6); // system + 5
      expect(result[0]).toEqual({ role: 'system', content: 'You are helpful.' });
      // Last 5 conversation messages are msg-5 through msg-9.
      expect(result[1].content).toBe('msg-5');
      expect(result[5].content).toBe('msg-9');
    } finally {
      (config as any).GALILEO_MAX_LOCAL_CONTEXT_MESSAGES = original;
    }
  });

  it('always preserves the system message as the first message', async () => {
    const config = await import('./config.js');
    const original = config.GALILEO_MAX_LOCAL_CONTEXT_MESSAGES;
    (config as any).GALILEO_MAX_LOCAL_CONTEXT_MESSAGES = 3;

    try {
      const msgs = makeMessages(20);
      const result = trimMessages(msgs as any);

      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe('You are helpful.');
      expect(result.length).toBe(4); // system + 3
    } finally {
      (config as any).GALILEO_MAX_LOCAL_CONTEXT_MESSAGES = original;
    }
  });

  it('disables trimming when limit is 0', async () => {
    const config = await import('./config.js');
    const original = config.GALILEO_MAX_LOCAL_CONTEXT_MESSAGES;
    (config as any).GALILEO_MAX_LOCAL_CONTEXT_MESSAGES = 0;

    try {
      const msgs = makeMessages(50);
      const result = trimMessages(msgs as any);
      expect(result).toEqual(msgs);
      expect(result.length).toBe(51); // system + 50
    } finally {
      (config as any).GALILEO_MAX_LOCAL_CONTEXT_MESSAGES = original;
    }
  });

  it('does not trim messages exactly at the limit', async () => {
    const config = await import('./config.js');
    const original = config.GALILEO_MAX_LOCAL_CONTEXT_MESSAGES;
    (config as any).GALILEO_MAX_LOCAL_CONTEXT_MESSAGES = 10;

    try {
      const msgs = makeMessages(10); // system + exactly 10
      const result = trimMessages(msgs as any);
      expect(result).toEqual(msgs);
      expect(result.length).toBe(11);
    } finally {
      (config as any).GALILEO_MAX_LOCAL_CONTEXT_MESSAGES = original;
    }
  });
});
