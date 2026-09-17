import { Injectable } from '@angular/core';
import { ChatResponse } from '../models';

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  onDone: (result: ChatResponse) => void;
}

interface SseError {
  message: string;
  code: string;
  status: number;
}

export class ChatStreamError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ChatStreamError';
  }
}

/** Parses one `event: ...\ndata: ...` SSE record into its event name and JSON payload. */
function parseSseRecord(record: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of record.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: JSON.parse(dataLines.join('\n')) };
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly sessionId = generateSessionId();

  /** Streams an agent response over SSE, calling onToken as text arrives and onDone once with the final result. */
  async streamMessage(message: string, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, message }),
      signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`Chat stream request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const record = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const parsed = parseSseRecord(record);
        if (!parsed) continue;

        if (parsed.event === 'token') {
          handlers.onToken((parsed.data as { text: string }).text);
        } else if (parsed.event === 'done') {
          handlers.onDone(parsed.data as ChatResponse);
        } else if (parsed.event === 'error') {
          const err = parsed.data as SseError;
          throw new ChatStreamError(err.message, err.code);
        }
      }
    }
  }
}
