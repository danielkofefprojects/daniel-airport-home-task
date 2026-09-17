export interface EvidenceItem {
  tool: string;
  artifact: {
    data: unknown;
    sources: string[];
    asOf: string;
    caveats: string[];
  };
}

export interface ChatResponse {
  answer: string;
  evidence: EvidenceItem[];
  toolsUsed: string[];
  model: string | undefined;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
}

export type ChatRole = 'user' | 'agent';

export interface ChatMessage {
  role: ChatRole;
  text: string;
  evidence?: EvidenceItem[];
}
