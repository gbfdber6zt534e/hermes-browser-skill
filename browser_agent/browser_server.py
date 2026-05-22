# browser_server.py — Hermes Browser Agent + Perplexity Bridge + WebGUI
# Port: 7421

import asyncio
import base64
import json
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

# ─── Logging Queue (für WebGUI Terminal) ────────────────────────────────────
LOG_BUFFER: deque = deque(maxlen=200)

def log(level: str, msg: str):
    entry = {
        "ts": datetime.now().strftime("%H:%M:%S"),
        "level": level,  # info | ok | warn | error
        "msg": msg,
    }
    LOG_BUFFER.append(entry)
    icon = {"info": "ℹ", "ok": "✓", "warn": "⚠", "error": "✗"}.get(level, "•")
    print(f"[{entry['ts']}] {icon} {msg}")

# ─── Browser State ───────────────────────────────────────────────────────────
_pw = None
_browser: Optional[Browser] = None
_context: Optional[BrowserContext] = None
_page: Optional[Page] = None
_start_time = time.time()
_request_count = 0

async def get_or_create_page() -> Page:
    global _pw, _browser, _context, _page
    if _page is not None and not _page.is_closed():
        return _page
    log("info", "Browser wird gestartet...")
    if _browser is None or not _browser.is_connected():
        if _pw is None:
            _pw = await async_playwright().__aenter__()
        _browser = await _pw.chromium.launch(
            headless=False,
            args=[
                "--start-maximized",
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        log("ok", "Chromium gestartet")
    _context = await _browser.new_context(
        no_viewport=True,
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    )
    _page = await _context.new_page()
    log("ok", f"Neue Browser-Seite erstellt")
    return _page

# ─── FastAPI App ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log("ok", "Browser Agent gestartet auf http://127.0.0.1:7421")
    log("info", "WebGUI erreichbar unter http://127.0.0.1:7421/gui")
    yield
    if _browser:
        await _browser.close()
        log("info", "Browser geschlossen")

app = FastAPI(title="Hermes Browser Agent", version="1.0.0", lifespan=lifespan)

# ─── Request Models ──────────────────────────────────────────────────────────
class NavigateReq(BaseModel):
    url: str

class ClickReq(BaseModel):
    selector: str
    method: str = "css"

class TypeReq(BaseModel):
    selector: str
    text: str
    clear_first: bool = True

class ScrollReq(BaseModel):
    direction: str = "down"
    amount: int = 500

class WaitReq(BaseModel):
    ms: int = 1000

class GetTextReq(BaseModel):
    selector: str = "body"

class EvalReq(BaseModel):
    script: str

class KeyboardReq(BaseModel):
    key: str

# ─── Middleware: Request Counter ─────────────────────────────────────────────
@app.middleware("http")
async def count_requests(request: Request, call_next):
    global _request_count
    if not request.url.path.startswith("/gui") and request.url.path != "/logs":
        _request_count += 1
    return await call_next(request)

# ─── Browser Endpoints ───────────────────────────────────────────────────────
@app.post("/navigate")
async def navigate(req: NavigateReq):
    try:
        page = await get_or_create_page()
        log("info", f"Navigiere zu: {req.url}")
        resp = await page.goto(req.url, wait_until="domcontentloaded", timeout=30_000)
        title = await page.title()
        status = resp.status if resp else 0
        log("ok", f"Geladen: '{title}' (HTTP {status})")
        return {"ok": True, "title": title, "url": page.url, "status": status}
    except Exception as e:
        log("error", f"navigate fehlgeschlagen: {e}")
        return {"ok": False, "error": str(e)}

@app.get("/screenshot")
async def screenshot():
    try:
        page = await get_or_create_page()
        data = await page.screenshot(type="jpeg", quality=75, full_page=False)
        b64 = base64.b64encode(data).decode()
        log("ok", f"Screenshot gemacht ({len(data)//1024}KB)")
        return {"ok": True, "image_base64": b64, "mime": "image/jpeg"}
    except Exception as e:
        log("error", f"screenshot fehlgeschlagen: {e}")
        return {"ok": False, "error": str(e)}

@app.post("/get_text")
async def get_text(req: GetTextReq):
    try:
        page = await get_or_create_page()
        el = page.locator(req.selector).first
        text = await el.inner_text(timeout=5_000)
        log("ok", f"Text gelesen ({len(text)} Zeichen) von '{req.selector}'")
        return {"ok": True, "text": text[:8000], "truncated": len(text) > 8000}
    except Exception as e:
        log("error", f"get_text fehlgeschlagen (selector='{req.selector}'): {e}")
        return {"ok": False, "error": str(e)}

@app.post("/click")
async def click(req: ClickReq):
    try:
        page = await get_or_create_page()
        log("info", f"Klicke auf '{req.selector}' (method={req.method})")
        if req.method == "text":
            await page.get_by_text(req.selector).first.click(timeout=10_000)
        elif req.method == "role":
            role, name = req.selector.split(":", 1)
            await page.get_by_role(role, name=name).first.click(timeout=10_000)
        else:
            await page.locator(req.selector).first.click(timeout=10_000)
        await page.wait_for_load_state("domcontentloaded")
        log("ok", f"Geklickt. Aktuelle URL: {page.url}")
        return {"ok": True, "current_url": page.url}
    except Exception as e:
        log("error", f"click fehlgeschlagen (selector='{req.selector}'): {e}")
        return {"ok": False, "error": str(e)}

@app.post("/type")
async def type_text(req: TypeReq):
    try:
        page = await get_or_create_page()
        locator = page.locator(req.selector).first
        if req.clear_first:
            await locator.fill("", timeout=5_000)
        await locator.type(req.text, delay=40)
        log("ok", f"Getippt: '{req.text[:40]}{'...' if len(req.text)>40 else ''}' in '{req.selector}'")
        return {"ok": True}
    except Exception as e:
        log("error", f"type fehlgeschlagen (selector='{req.selector}'): {e}")
        return {"ok": False, "error": str(e)}

@app.post("/scroll")
async def scroll(req: ScrollReq):
    try:
        page = await get_or_create_page()
        if req.direction == "top":
            await page.evaluate("window.scrollTo(0, 0)")
        elif req.direction == "bottom":
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        elif req.direction == "up":
            await page.evaluate(f"window.scrollBy(0, -{req.amount})")
        else:
            await page.evaluate(f"window.scrollBy(0, {req.amount})")
        log("info", f"Scroll {req.direction} ({req.amount}px)")
        return {"ok": True}
    except Exception as e:
        log("error", f"scroll fehlgeschlagen: {e}")
        return {"ok": False, "error": str(e)}

@app.post("/wait")
async def wait(req: WaitReq):
    await asyncio.sleep(req.ms / 1000)
    log("info", f"Gewartet {req.ms}ms")
    return {"ok": True}

@app.post("/eval")
async def eval_js(req: EvalReq):
    try:
        page = await get_or_create_page()
        result = await page.evaluate(req.script)
        log("ok", f"JS eval: {str(result)[:100]}")
        return {"ok": True, "result": str(result)}
    except Exception as e:
        log("error", f"eval fehlgeschlagen: {e}")
        return {"ok": False, "error": str(e)}

@app.post("/keyboard")
async def keyboard(req: KeyboardReq):
    try:
        page = await get_or_create_page()
        await page.keyboard.press(req.key)
        log("ok", f"Taste gedrückt: {req.key}")
        return {"ok": True}
    except Exception as e:
        log("error", f"keyboard fehlgeschlagen: {e}")
        return {"ok": False, "error": str(e)}

@app.post("/close")
async def close():
    global _browser, _page, _context, _pw
    try:
        if _browser:
            await _browser.close()
            _browser = None
            _page = None
            _context = None
        log("ok", "Browser geschlossen")
        return {"ok": True}
    except Exception as e:
        log("error", f"close fehlgeschlagen: {e}")
        return {"ok": False, "error": str(e)}

@app.get("/status")
async def status():
    is_open = _page is not None and not _page.is_closed()
    uptime = int(time.time() - _start_time)
    return {
        "ok": True,
        "browser_open": is_open,
        "current_url": _page.url if is_open else None,
        "uptime_seconds": uptime,
        "request_count": _request_count,
    }

@app.get("/logs")
async def get_logs():
    return {"logs": list(LOG_BUFFER)}

# ─── WebGUI ──────────────────────────────────────────────────────────────────
@app.get("/gui", response_class=HTMLResponse)
async def gui():
    html = Path(__file__).parent / "gui.html"
    if html.exists():
        return HTMLResponse(html.read_text())
    return HTMLResponse("<h1>gui.html nicht gefunden</h1>", status_code=404)

# ─── Start ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7421, log_level="warning")
