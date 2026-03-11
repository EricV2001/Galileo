/**
 * Anthropic <-> OpenAI API format translation.
 *
 * The credential proxy uses these functions to intercept requests from the
 * Claude Agent SDK (Anthropic format) and translate them for LM Studio
 * (OpenAI-compatible format), then translate responses back.
 *
 * Handles non-streaming requests/responses and SSE streaming chunks.
 */

import crypto from 'node:crypto';
import { GALILEO_MODEL_GENERAL } from './config.js';

// -- Types ----------------------------------------------------------------

/** Anthropic content block types. */
interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

/** OpenAI tool call in an assistant message. */
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** OpenAI message shapes. */
interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

// -- Request translation (Anthropic -> OpenAI) ----------------------------

/**
 * Translate an Anthropic Messages API request body to OpenAI Chat
 * Completions format suitable for LM Studio.
 */
export function translateRequest(anthropicBody: any): {
  url: string;
  body: any;
  headers: Record<string, string>;
} {
  const messages: OpenAIMessage[] = [];

  // System prompt becomes a system message.
  if (anthropicBody.system) {
    const systemText =
      typeof anthropicBody.system === 'string'
        ? anthropicBody.system
        : Array.isArray(anthropicBody.system)
          ? (anthropicBody.system as AnthropicContentBlock[])
              .filter((b): b is AnthropicTextBlock => b.type === 'text')
              .map((b) => b.text)
              .join('\n')
          : '';
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }
  }

  // Translate each Anthropic message.
  for (const msg of anthropicBody.messages ?? []) {
    const converted = translateMessage(msg);
    messages.push(...converted);
  }

  // Translate tools.
  let tools: any[] | undefined;
  if (anthropicBody.tools?.length) {
    tools = anthropicBody.tools.map((t: AnthropicTool) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  const body: Record<string, unknown> = {
    model: GALILEO_MODEL_GENERAL,
    max_tokens: anthropicBody.max_tokens,
    messages,
    stream: anthropicBody.stream ?? false,
  };
  if (tools) body.tools = tools;

  return {
    url: '/v1/chat/completions',
    body,
    headers: { 'Content-Type': 'application/json' },
  };
}

/**
 * Convert one Anthropic message into one or more OpenAI messages.
 *
 * A single Anthropic user message can contain interleaved text and
 * tool_result blocks, so we may need to emit multiple OpenAI messages.
 * Similarly, an assistant message with tool_use blocks becomes a single
 * OpenAI assistant message with `tool_calls`.
 */
function translateMessage(msg: AnthropicMessage): OpenAIMessage[] {
  // Simple string content — pass through.
  if (typeof msg.content === 'string') {
    return [{ role: msg.role, content: msg.content }];
  }

  // Array content blocks.
  const blocks = msg.content as AnthropicContentBlock[];

  if (msg.role === 'assistant') {
    return translateAssistantBlocks(blocks);
  }

  // User messages can contain text + tool_result blocks.
  return translateUserBlocks(blocks);
}

function translateAssistantBlocks(blocks: AnthropicContentBlock[]): OpenAIMessage[] {
  const textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  const result: OpenAIMessage = {
    role: 'assistant',
    content: textParts.length > 0 ? textParts.join('\n') : null,
  };
  if (toolCalls.length > 0) result.tool_calls = toolCalls;

  return [result];
}

function translateUserBlocks(blocks: AnthropicContentBlock[]): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];
  const textParts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_result') {
      // Flush accumulated text first.
      if (textParts.length > 0) {
        messages.push({ role: 'user', content: textParts.join('\n') });
        textParts.length = 0;
      }
      const resultContent =
        typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? (block.content as AnthropicContentBlock[])
                .filter((b): b is AnthropicTextBlock => b.type === 'text')
                .map((b) => b.text)
                .join('\n')
            : '';
      messages.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: resultContent,
      });
    }
  }

  // Flush remaining text.
  if (textParts.length > 0) {
    messages.push({ role: 'user', content: textParts.join('\n') });
  }

  return messages;
}

// -- Response translation (OpenAI -> Anthropic) ---------------------------

/**
 * Translate an OpenAI Chat Completions response to Anthropic Messages
 * format.
 */
export function translateResponse(openaiBody: any): any {
  const choice = openaiBody.choices?.[0];
  const message = choice?.message;

  const content: AnthropicContentBlock[] = [];

  if (message?.content) {
    content.push({ type: 'text', text: message.content });
  }

  if (message?.tool_calls) {
    for (const call of message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: safeJsonParse(call.function.arguments),
      });
    }
  }

  // Map finish_reason to Anthropic stop_reason.
  let stopReason: string;
  switch (choice?.finish_reason) {
    case 'tool_calls':
      stopReason = 'tool_use';
      break;
    case 'length':
      stopReason = 'max_tokens';
      break;
    default:
      stopReason = 'end_turn';
  }

  return {
    id: `msg_${openaiBody.id || crypto.randomUUID()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: GALILEO_MODEL_GENERAL,
    stop_reason: stopReason,
    usage: {
      input_tokens: openaiBody.usage?.prompt_tokens ?? 0,
      output_tokens: openaiBody.usage?.completion_tokens ?? 0,
    },
  };
}

// -- Streaming translation (OpenAI SSE -> Anthropic SSE) ------------------

/**
 * Create a stateful streaming translator. Each call to the returned
 * function translates one OpenAI SSE chunk into zero or more Anthropic
 * SSE event strings.
 */
export function createStreamTranslator(): (chunk: string) => string[] {
  let messageStarted = false;
  let contentBlockIndex = 0;
  let activeBlockType: 'text' | 'tool_use' | null = null;

  return (chunk: string): string[] => {
    const trimmed = chunk.trim();

    // Handle stream termination.
    if (trimmed === 'data: [DONE]') {
      const events: string[] = [];
      if (activeBlockType) {
        events.push(
          `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex })}`,
        );
        activeBlockType = null;
      }
      events.push(
        `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } })}`,
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}`,
      );
      return events;
    }

    // Extract JSON payload from "data: {...}".
    if (!trimmed.startsWith('data: ')) return [];
    const jsonStr = trimmed.slice(6);

    let data: any;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      return [];
    }

    const delta = data.choices?.[0]?.delta;
    const finishReason = data.choices?.[0]?.finish_reason;
    if (!delta && !finishReason) return [];

    const events: string[] = [];

    // Emit message_start on the first chunk.
    if (!messageStarted) {
      messageStarted = true;
      events.push(
        `event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: `msg_${data.id || crypto.randomUUID()}`,
            type: 'message',
            role: 'assistant',
            content: [],
            model: GALILEO_MODEL_GENERAL,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        })}`,
      );
    }

    // Text content delta.
    if (delta?.content) {
      // Start a text block if we're not in one.
      if (activeBlockType !== 'text') {
        if (activeBlockType) {
          events.push(
            `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex })}`,
          );
          contentBlockIndex++;
        }
        events.push(
          `event: content_block_start\ndata: ${JSON.stringify({
            type: 'content_block_start',
            index: contentBlockIndex,
            content_block: { type: 'text', text: '' },
          })}`,
        );
        activeBlockType = 'text';
      }
      events.push(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: { type: 'text_delta', text: delta.content },
        })}`,
      );
    }

    // Tool call deltas.
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        // If we have a function name, this is the start of a new tool_use block.
        if (tc.function?.name) {
          if (activeBlockType) {
            events.push(
              `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex })}`,
            );
            contentBlockIndex++;
          }
          events.push(
            `event: content_block_start\ndata: ${JSON.stringify({
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: {
                type: 'tool_use',
                id: tc.id || `call_${crypto.randomUUID()}`,
                name: tc.function.name,
              },
            })}`,
          );
          activeBlockType = 'tool_use';
        }
        // Argument fragment.
        if (tc.function?.arguments) {
          events.push(
            `event: content_block_delta\ndata: ${JSON.stringify({
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: tc.function.arguments,
              },
            })}`,
          );
        }
      }
    }

    // Finish reason — close out blocks and message.
    if (finishReason) {
      if (activeBlockType) {
        events.push(
          `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex })}`,
        );
        activeBlockType = null;
      }

      let stopReason: string;
      switch (finishReason) {
        case 'tool_calls':
          stopReason = 'tool_use';
          break;
        case 'length':
          stopReason = 'max_tokens';
          break;
        default:
          stopReason = 'end_turn';
      }

      events.push(
        `event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: stopReason },
          usage: { output_tokens: data.usage?.completion_tokens ?? 0 },
        })}`,
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}`,
      );
    }

    return events;
  };
}

// -- Utilities ------------------------------------------------------------

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return {};
  }
}
