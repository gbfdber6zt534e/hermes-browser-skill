import puppeteer from 'puppeteer-core';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { PerplexitySession } from './types';

const CHROME_PATHS = [
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

function findChrome(): string {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) {
      console.log(`[auth] Chrome gefunden: ${p}`);
      return p;
    }
  }
  throw new Error(
    'Chrome nicht gefunden. Setze CHROME_PATH env variable.\n' +
    'Beispiel: export CHROME_PATH="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"'
  );
}

function ensureAuthDir(authDir: string): void {
  const expanded = authDir.replace('~', process.env.HOME || '/root');
  if (!fs.existsSync(expanded)) {
    fs.mkdirSync(expanded, { recursive: true });
    console.log(`[auth] Auth-Verzeichnis erstellt: ${expanded}`);
  }
}

export async function loginWithBrowser(
  authDir: string,
  headless: boolean = false
): Promise<PerplexitySession> {
  const chromePath = process.env.CHROME_PATH || findChrome();
  const expandedDir = authDir.replace('~', process.env.HOME || '/root');
  ensureAuthDir(expandedDir);

  console.log(`[auth] Starte Browser: ${chromePath}`);
  console.log(`[auth] headless=${headless}`);
  console.log('[auth] Öffne perplexity.ai ...');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: headless ? ('new' as any) : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--start-maximized',
    ],
  });

  const page = await browser.newPage();
  await page.goto('https://www.perplexity.ai/', { waitUntil: 'networkidle2' });

  if (!headless) {
    console.log('[auth] ════════════════════════════════════════');
    console.log('[auth] Bitte logge dich im Browser-Fenster ein.');
    console.log('[auth] Das Script wartet automatisch (max. 3 Minuten)...');
    console.log('[auth] ════════════════════════════════════════');

    try {
      await page.waitForFunction(
        () => {
          const cookies = document.cookie;
          return cookies.includes('next-auth') ||
                 cookies.includes('pplx') ||
                 document.querySelector('[data-testid="user-avatar"]') !== null;
        },
        { timeout: 180_000 }
      );
      console.log('[auth] Login erkannt!');
    } catch {
      console.warn('[auth] Timeout beim Warten auf Login. Versuche Cookies trotzdem zu extrahieren...');
    }
  }

  const cookies = await page.cookies();
  await browser.close();

  const cookieString = cookies
    .filter(c => c.domain.includes('perplexity.ai'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  if (!cookieString) {
    throw new Error(
      'Keine Perplexity-Cookies gefunden.\n' +
      'Stelle sicher dass du eingeloggt bist, dann versuche: npm run login:manual'
    );
  }

  const session: PerplexitySession = {
    cookie: cookieString,
    savedAt: new Date().toISOString(),
  };

  const sessionFile = path.join(expandedDir, 'perplexity-session.json');
  fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  console.log(`[auth] ✓ Session gespeichert: ${sessionFile}`);
  console.log(`[auth] Cookie-Länge: ${cookieString.length} Zeichen`);

  return session;
}

export async function loginManual(authDir: string): Promise<PerplexitySession> {
  const expandedDir = authDir.replace('~', process.env.HOME || '/root');
  ensureAuthDir(expandedDir);

  console.log('\n[auth] ══════════════════════════════════════════════');
  console.log('[auth] MANUELLER LOGIN — Anleitung:');
  console.log('[auth] 1. Öffne https://www.perplexity.ai im Browser');
  console.log('[auth] 2. Logge dich ein');
  console.log('[auth] 3. Öffne DevTools: F12 → Application → Cookies → perplexity.ai');
  console.log('[auth] 4. Kopiere alle Cookies als "name=value; name2=value2" Format');
  console.log('[auth] ══════════════════════════════════════════════\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve, reject) => {
    rl.question('Cookie-String einfügen (Ctrl+C zum Abbrechen): ', (cookie) => {
      rl.close();
      const trimmed = cookie.trim();

      if (!trimmed) {
        reject(new Error('Leerer Cookie-String eingegeben.'));
        return;
      }

      const session: PerplexitySession = {
        cookie: trimmed,
        savedAt: new Date().toISOString(),
      };

      const sessionFile = path.join(expandedDir, 'perplexity-session.json');
      fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
      console.log(`\n[auth] ✓ Session gespeichert: ${sessionFile}`);
      resolve(session);
    });
  });
}

export function loadSession(authDir: string): PerplexitySession | null {
  const expandedDir = authDir.replace('~', process.env.HOME || '/root');
  const sessionFile = path.join(expandedDir, 'perplexity-session.json');

  if (!fs.existsSync(sessionFile)) {
    return null;
  }

  try {
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as PerplexitySession;
    const ageHours = (Date.now() - new Date(session.savedAt).getTime()) / 3_600_000;
    if (ageHours > 24) {
      console.warn(`[auth] ⚠ Session ist ${Math.floor(ageHours)}h alt — möglicherweise abgelaufen. Ggf. neu einloggen.`);
    }
    return session;
  } catch (e) {
    console.error(`[auth] Session-Datei konnte nicht gelesen werden: ${e}`);
    return null;
  }
}
