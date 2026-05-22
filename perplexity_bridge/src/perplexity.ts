import axios, { AxiosInstance } from 'axios';
import { PerplexitySession, ChatMessage } from './types';

const PPLX_BASE = 'https://www.perplexity.ai';
const PPLX_SSE  = 'https://www.perplexity.ai/rest/sse/perplexity_ask';

export const MODEL_MAP: Record<string, string> = {
  // Perplexity native
  'sonar':                  'pplx-7b-online',
  'sonar-pro':              'pplx-70b-online',
  'sonar-reasoning':        'r1-1776',
  'sonar-deep':             'pplx-sonar-deep-research',
  // OpenAI-style Aliase → Perplexity fallback
  'gpt-4':                  'pplx-70b-online',
  'gpt-4o':                 'pplx-70b-online',
  'gpt-3.5-turbo':          'pplx-7b-online',
  'claude-3-opus':          'pplx-70b-online',
  'default':                'pplx-7b-online',
};

export function resolveModel(model?: string): string {
  if (!model) return MODEL_MAP['default'];
  return MODEL_MAP[model] || model;
}

export class PerplexityClient {
  private http: AxiosInstance;
  private session: PerplexitySession;

  constructor(session: PerplexitySession) {
    this.session = session;
    this.http = axios.create({
      baseURL: PPLX_BASE,
      headers: {
        'Cookie': session.cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/event-stream',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Referer': 'https://www.perplexity.ai/',
        'Origin': 'https://www.perplexity.ai',
        'Content-Type': 'application/json',
      },
      responseType: 'stream',
      timeout: 120_000,
    });
  }

  private buildQuery(messages: ChatMessage[]): string {
    const system = messages.find(m => m.role === 'system')?.content || '';
    const userMsgs = messages.filter(m => m.role === 'user');
    const lastUser = userMsgs[userMsgs.length - 1]?.content || '';
    return system ? `[Kontext: ${system}]\n\n${lastUser}` : lastUser;
  }

  async *streamCompletion(
    messages: ChatMessage[],
    model: string = 'pplx-7b-online'
  ): AsyncGenerator<string, void, unknown> {
    const query = this.buildQuery(messages);
    const resolvedModel = resolveModel(model);

    const body = {
      query,
      mode: 'concise',
      search_focus: 'internet',
      model_preference: resolvedModel,
      is_related_query: false,
      is_default_related_query: false,
      visitor_id: crypto.randomUUID(),
      frontend_context_uuid: crypto.randomUUID(),
      prompt_source: 'user',
      query_source: 'home',
    };

    let response;
    try {
      response = await this.http.post(PPLX_SSE, body);
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        throw new Error(
          `Session abgelaufen oder ungültig (HTTP ${status}).\n` +
          'Bitte neu einloggen: npm run login'
        );
      }
      if (status === 429) {
        throw new Error('Rate-Limit erreicht (HTTP 429). Kurz warten und nochmal versuchen.');
      }
      throw new Error(`Perplexity Upstream-Fehler: ${err.message}`);
    }

    let buffer = '';
    let hasYielded = false;

    for await (const chunk of response.data) {
      buffer += (chunk as Buffer).toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const text = parsed.output ?? parsed.text ?? parsed.answer ?? parsed.delta?.text;
          if (text) {
            hasYielded = true;
            yield text;
          }
        } catch {
          // Nicht-JSON SSE Zeilen ignorieren
        }
      }
    }

    if (!hasYielded) {
      throw new Error(
        'Keine Antwort von Perplexity erhalten. ' +
        'Möglicherweise hat sich das SSE-Format geändert oder die Session ist abgelaufen.'
      );
    }
  }
}
