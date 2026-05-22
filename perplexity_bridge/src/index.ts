import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import * as crypto from 'crypto';
import { Config } from './types';
import { loginWithBrowser, loginManual } from './auth';
import { createServer } from './server';

const DEFAULT_CONFIG: Config = {
  host: '127.0.0.1',
  port: 8319,
  'api-keys': [],
  'auth-dir': path.join(process.env.HOME || '~', '.perplexity-auth2api'),
  headless: false,
  debug: 'errors',
};

function loadConfig(): Config {
  const configPath = path.resolve('./config.yaml');
  let config = { ...DEFAULT_CONFIG };

  if (fs.existsSync(configPath)) {
    const raw = yaml.parse(fs.readFileSync(configPath, 'utf-8'));
    config = { ...config, ...raw };
  } else {
    const apiKey = `ppx-${crypto.randomBytes(24).toString('hex')}`;
    config['api-keys'] = [apiKey];
    fs.writeFileSync(configPath, yaml.stringify(config));
    console.log('\n[config] ╔════════════════════════════════════════╗');
    console.log('[config] ║  Neue config.yaml erstellt!            ║');
    console.log(`[config] ║  API Key: ${apiKey.slice(0, 32)}... ║`);
    console.log('[config] ╚════════════════════════════════════════╝\n');
  }

  if (config['api-keys'].length === 0) {
    const apiKey = `ppx-${crypto.randomBytes(24).toString('hex')}`;
    config['api-keys'] = [apiKey];
    fs.writeFileSync(configPath, yaml.stringify(config));
    console.log(`[config] Neuer API Key generiert: ${apiKey}`);
  }

  return config;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   Perplexity Auth2API Bridge v1.0    ║');
  console.log('╚══════════════════════════════════════╝\n');

  const config = loadConfig();

  if (args.includes('--login')) {
    console.log('[login] Login-Flow gestartet...');
    try {
      if (args.includes('--manual')) {
        await loginManual(config['auth-dir']);
      } else {
        const headless = config.headless || args.includes('--headless');
        await loginWithBrowser(config['auth-dir'], headless);
      }
      console.log('\n[login] ✓ Login erfolgreich!');
      console.log('[login] Starte den Server: npm start');
    } catch (err: any) {
      console.error(`\n[login] ✗ Login fehlgeschlagen: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Server starten
  const app = createServer(config);
  const host = config.host || '127.0.0.1';
  const port = config.port || 8319;

  app.listen(port, host, () => {
    console.log(`[server] ✓ Lauscht auf http://${host}:${port}`);
    console.log(`[server] API Keys: ${config['api-keys'].length} konfiguriert`);
    console.log(`[server] Debug-Level: ${config.debug}`);
    console.log('\nEndpoints:');
    console.log(`  GET  http://${host}:${port}/health`);
    console.log(`  GET  http://${host}:${port}/v1/models`);
    console.log(`  POST http://${host}:${port}/v1/chat/completions`);
    console.log(`  GET  http://${host}:${port}/admin/session`);
    console.log('\n[server] Bereit. Warte auf Anfragen...');
  });
}

main().catch(err => {
  console.error(`\n[fatal] ✗ ${err.message}`);
  process.exit(1);
});
