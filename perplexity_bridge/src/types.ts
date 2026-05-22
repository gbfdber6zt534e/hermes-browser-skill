export interface Config {
  host: string;
  port: number;
  'api-keys': string[];
  'auth-dir': string;
  headless: boolean;
  debug: 'off' | 'errors' | 'verbose';
}

export interface PerplexitySession {
  cookie: string;
  email?: string;
  savedAt: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OpenAIRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}
