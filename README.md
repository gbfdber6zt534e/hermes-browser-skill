# hermes-browser-skill

**Hermes Agent Skills**: Browser Agent + Perplexity Auth2API Bridge + WebGUI

> Playwright-basierter Browser-Agent mit sichtbarem Fenster, Perplexity-Session-Bridge und einer lokalen Web-GUI zur Steuerung.

---

## Stack

| Komponente | Tech | Port |
|---|---|---|
| Browser Agent | Python + FastAPI + Playwright | `7421` |
| Perplexity Auth2API | Node.js + Express + Puppeteer | `8319` |
| WebGUI | HTML/JS (served by Browser Agent) | `7421/gui` |

---

## Schnellstart

```bash
# 1. Repo klonen
git clone https://github.com/gbfdber6zt534e/hermes-browser-skill
cd hermes-browser-skill

# 2. Browser Agent installieren
cd browser_agent
pip install -r requirements.txt
playwright install chromium

# 3. Perplexity Bridge installieren
cd ../perplexity_bridge
npm install && npm run build

# 4. Perplexity Login (Browser öffnet sich)
npm run login
# ODER manuell via Cookie:
npm run login:manual

# 5. Alles starten
cd ..
bash start_all.sh
```

Danach:
- **WebGUI**: http://127.0.0.1:7421/gui
- **Browser Agent API**: http://127.0.0.1:7421
- **Perplexity API**: http://127.0.0.1:8319

---

## WSL2 Display

```bash
# WSLg (Windows 11) — funktioniert automatisch
echo $DISPLAY  # sollte :0 zeigen

# Falls nicht gesetzt:
export DISPLAY=:0

# Windows Chrome für Puppeteer (Perplexity Login)
export CHROME_PATH="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
```

---

## Hermes Tool-Config

Siehe `browser_agent/tools.yaml` für alle Tool-Definitionen die du in Hermes' system prompt einfügst.
