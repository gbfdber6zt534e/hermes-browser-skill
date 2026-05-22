import express, { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { Config, OpenAIRequest } from './types';
import { PerplexityClient, MODEL_MAP, resolveModel } from './perplexity';
import { loadSession } from './auth';

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function log(config: Config, level: 'info' | 'error' | 'verbose', msg: string): void {
  if (config.debug === 'off') return;
  if (config.debug === 'errors' && level !== 'error') return;
  const icon = { info: 'ℹ', error: '✗', verbose: '→' }[level];
  console.log(`[${new Date().toLocaleTimeString('de-DE')}] ${icon} ${msg}`);
}

export function createServer(config: Config) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // CORS
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin || '';
    if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Auth
  const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers.authorization?.replace('Bearer ', '') ||
                (req.headers['x-api-key'] as string);
    if (!key || !config['api-keys'].some(k => timingSafeCompare(k, key))) {
      log(config, 'error', `Auth fehlgeschlagen von ${req.ip} — ${req.path}`);
      return res.status(401).json({ error: { message: 'Ungültiger API Key', type: 'auth_error', code: 401 } });
    }
    next();
  };

  // Health
  app.get('/health', (_req, res) => {
    const session = loadSession(config['auth-dir']);
    res.json({
      status: 'ok',
      provider: 'perplexity-auth2api',
      session_loaded: session !== null,
      session_age_hours: session
        ? Math.round((Date.now() - new Date(session.savedAt).getTime()) / 3_600_000)
        : null,
    });
  });

  // Models
  app.get('/v1/models', apiKeyAuth, (_req, res) => {
    const models = Object.keys(MODEL_MAP).filter(k => k !== 'default').map(id => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'perplexity',
    }));
    res.json({ object: 'list', data: models });
  });

  // Chat Completions
  app.post('/v1/chat/completions', apiKeyAuth, async (req: Request, res: Response) => {
    const session = loadSession(config['auth-dir']);
    if (!session) {
      return res.status(503).json({
        error: {
          message: 'Keine aktive Session. Bitte einloggen: cd perplexity_bridge && npm run login',
          type: 'session_error',
          code: 503,
        },
      });
    }

    const body = req.body as OpenAIRequest;
    const stream = body.stream ?? false;
    const model = resolveModel(body.model);
    const client = new PerplexityClient(session);
    const reqId = `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 29)}`;
    const created = Math.floor(Date.now() / 1000);

    log(config, 'verbose', `POST /v1/chat/completions model=${model} stream=${stream} ip=${req.ip}`);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      try {
        for await (const token of client.streamCompletion(body.messages, model)) {
          const chunk = {
            id: reqId, object: 'chat.completion.chunk', created, model,
            choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ id: reqId, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        log(config, 'verbose', `Stream fertig für ${reqId}`);
      } catch (err: any) {
        log(config, 'error', `Stream-Fehler: ${err.message}`);
        res.write(`data: ${JSON.stringify({ error: { message: err.message, type: 'upstream_error' } })}\n\n`);
        res.end();
      }
    } else {
      try {
        let fullText = '';
        for await (const token of client.streamCompletion(body.messages, model)) {
          fullText += token;
        }
        log(config, 'verbose', `Antwort: ${fullText.length} Zeichen`);
        res.json({
          id: reqId, object: 'chat.completion', created, model,
          choices: [{ index: 0, message: { role: 'assistant', content: fullText }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      } catch (err: any) {
        log(config, 'error', `Request-Fehler: ${err.message}`);
        res.status(500).json({ error: { message: err.message, type: 'upstream_error', code: 500 } });
      }
    }
  });

  // Session Info
  app.get('/admin/session', apiKeyAuth, (_req, res) => {
    const session = loadSession(config['auth-dir']);
    if (!session) return res.status(404).json({ status: 'no_session', message: 'Bitte einloggen: npm run login' });
    res.json({
      status: 'active',
      savedAt: session.savedAt,
      age_hours: Math.round((Date.now() - new Date(session.savedAt).getTime()) / 3_600_000),
      cookie_length: session.cookie.length,
    });
  });

  return app;
}
