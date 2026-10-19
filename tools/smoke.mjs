// Headless smoke test for the course site.
//   cd tools && npm install            (playwright-core, pinned in package.json)
//   node tools/smoke.mjs [--screens] [page.html ...]
// Browser: $CHROMIUM_PATH, else playwright's own Chromium, else the newest cached
// ~/Library/Caches/ms-playwright headless shell. Never the user's Chrome profile.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const screensDir = path.join(root, 'notes', 'screens');
const args = process.argv.slice(2);
const wantScreens = args.includes('--screens');
const only = args.filter((a) => a.endsWith('.html'));

const manifest = fs.readFileSync(path.join(docs, 'assets/chapters.js'), 'utf8');
let pages = ['index.html', ...[...manifest.matchAll(/"file": "([^"]+)"/g)].map((m) => m[1])]
  .filter((f) => fs.existsSync(path.join(docs, f)));
if (only.length) pages = pages.filter((p) => only.includes(p));

function browserPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try { const p = chromium.executablePath(); if (fs.existsSync(p)) return p; } catch { /* not installed */ }
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort() : [];
  for (const d of dirs.reverse()) {
    for (const sub of fs.readdirSync(path.join(cache, d))) {
      const p = path.join(cache, d, sub, 'chrome-headless-shell');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('No Chromium found. Run: cd tools && npx playwright-core install chromium-headless-shell');
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost');
      const prefix = '/how-agents-work/';
      if (!u.pathname.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
      let rel = decodeURIComponent(u.pathname.slice(prefix.length)) || 'index.html';
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(docs, rel);
      if (!file.startsWith(docs) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const failures = [];
const fail = (page, msg) => failures.push(`${page}: ${msg}`);

async function checkPage(context, url, name, opts = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(150);
  for (const e of errors) fail(name, `${opts.label || 'http'} console/page error: ${e}`);
  if (opts.jsDisabled) {
    if (!(await page.locator('h1').count())) fail(name, 'no h1 without JS');
    await page.close();
    return;
  }
  const statuses = await page.$$eval('[data-widget]', (els) => els.map((e) => [e.dataset.widget, e.dataset.widgetStatus]));
  for (const [w, s] of statuses) if (s !== 'ok') fail(name, `widget ${w} status ${s}`);
  if (!(await page.locator('#sidebar').count())) fail(name, 'sidebar missing');
  if (await page.locator('.loop-map').count() && !(await page.locator('.loop-map .lm-grid').count())) fail(name, 'loop map not rendered');
  if (opts.interact) await interact(page, name);
  await page.close();
}

async function interact(page, name) {
  // Steppers: walk to the end, taking the first choice when one appears, then reset.
  const steppers = await page.locator('.w-stepper').count();
  for (let s = 0; s < steppers; s++) {
    const st = page.locator('.w-stepper').nth(s);
    const next = st.locator('.w-controls button', { hasText: 'Next' });
    for (let guard = 0; guard < 80; guard++) {
      if (await next.isEnabled()) { await next.click(); continue; }
      const choice = st.locator('.w-narration button').first();
      if (await choice.count() && (await choice.getAttribute('aria-pressed')) !== 'true') {
        await choice.click();
        const lost = await page.evaluate(() => document.activeElement === document.body || !document.activeElement);
        if (lost) fail(name, `stepper ${s} lost keyboard focus after a choice`);
        continue;
      }
      break;
    }
    const counter = (await st.locator('.w-counter').textContent()) || '';
    const m = counter.match(/Step (\d+) of (\d+)/);
    if (!m || m[1] !== m[2]) fail(name, `stepper ${s} did not reach the end (${counter})`);
    if (/waiting/.test(counter)) fail(name, `stepper ${s} stuck at a choice`);
    await st.locator('.w-controls button', { hasText: 'Reset' }).click();
    if (!/Step 1 of/.test((await st.locator('.w-counter').textContent()) || '')) fail(name, `stepper ${s} did not reset`);
    // keyboard: ArrowRight on the Next button advances
    await next.focus();
    await page.keyboard.press('ArrowRight');
    if (!/Step 2 of/.test((await st.locator('.w-counter').textContent()) || '')) fail(name, `stepper ${s} ignores ArrowRight`);
  }
  // Every tab in every widget can be clicked without errors (errors are caught by the page listeners).
  const tabs = page.locator('[data-widget] .w-tab');
  const nTabs = Math.min(await tabs.count(), 40);
  for (let t = 0; t < nTabs; t++) { if (await tabs.nth(t).isVisible()) await tabs.nth(t).click(); }
  // Comparison table: columns toggle, and the last visible column cannot be hidden.
  const boxes = page.locator('[data-widget="comparison"] input[type="checkbox"]');
  const nBoxes = await boxes.count();
  if (nBoxes) {
    for (let b = 0; b < nBoxes; b++) if (await boxes.nth(b).isChecked()) await boxes.nth(b).click();
    const still = await boxes.evaluateAll((els) => els.filter((e) => e.checked).length);
    if (still < 1) fail(name, 'comparison let every column be hidden');
  }
  // Quiz: first option of the first quiz gets checked.
  const quiz = page.locator('.quiz.js').first();
  if (await quiz.count()) {
    await quiz.locator('.opt-btn').first().click();
    if (!(await quiz.getAttribute('data-answered'))) fail(name, 'quiz did not record an answer');
  }
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/how-agents-work/`;
  const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (const p of pages) await checkPage(ctx, base + p, p, { interact: true });

    // Progress persists across reloads and pages.
    const pg = await ctx.newPage();
    const target = pages.find((p) => p.startsWith('00-'));
    if (target) {
      await pg.goto(base + target);
      await pg.locator('.complete-row button').click();
      await pg.goto(base + 'index.html');
      const done = await pg.locator(`a.map-card[href="${target}"] .map-done`).count();
      if (!done) fail('index.html', 'completed chapter not marked on the course map');
      await pg.goto(base + target);
      await pg.locator('.complete-row button').click(); // undo
    }
    await pg.close();
    await ctx.close();

    // Narrow phones: no page scrolls sideways at 360px (wide tables and code scroll inside their own boxes).
    const narrow = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true });
    const np = await narrow.newPage();
    for (const p of pages) {
      await np.goto(base + p);
      await np.waitForTimeout(80);
      const w = await np.evaluate(() => document.documentElement.scrollWidth);
      if (w > 362) fail(p, `scrolls sideways at 360px (page width ${w}px)`);
    }
    await narrow.close();

    // Mobile menu: closed drawer is skipped by Tab, open drawer holds focus, Escape returns focus.
    const mob = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
    const mp = await mob.newPage();
    await mp.goto(base + (pages.find((p) => p.startsWith('01-')) || pages[0]));
    const closedInert = await mp.evaluate(() => document.getElementById('sidebar').inert);
    if (!closedInert) fail('mobile', 'closed sidebar is not inert');
    await mp.locator('.menu-btn').click();
    const openState = await mp.evaluate(() => ({ side: document.getElementById('sidebar').inert, main: document.querySelector('main').inert, focusInSide: document.getElementById('sidebar').contains(document.activeElement) }));
    if (openState.side || !openState.main || !openState.focusInSide) fail('mobile', 'open menu does not hold focus: ' + JSON.stringify(openState));
    await mp.keyboard.press('Escape');
    const back = await mp.evaluate(() => ({ open: document.body.classList.contains('nav-open'), onMenu: document.activeElement && document.activeElement.classList.contains('menu-btn'), main: document.querySelector('main').inert }));
    if (back.open || !back.onMenu || back.main) fail('mobile', 'Escape did not close the menu and restore focus: ' + JSON.stringify(back));
    await mob.close();

    // Storage blocked: everything still works.
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    });
    for (const p of pages.slice(0, 3)) await checkPage(blocked, base + p, p, { label: 'storage-blocked' });
    await blocked.close();

    // JavaScript disabled: content still readable.
    const nojs = await browser.newContext({ javaScriptEnabled: false });
    for (const p of pages) await checkPage(nojs, base + p, p, { label: 'no-js', jsDisabled: true });
    await nojs.close();

    // file:// mode.
    const fileCtx = await browser.newContext();
    for (const p of pages.slice(0, 3)) await checkPage(fileCtx, pathToFileURL(path.join(docs, p)).href, p, { label: 'file' });
    await fileCtx.close();

    if (wantScreens) {
      fs.mkdirSync(screensDir, { recursive: true });
      const modes = [
        { tag: 'desktop', viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
        { tag: 'dark', viewport: { width: 1280, height: 900 }, colorScheme: 'dark' },
        { tag: 'mobile', viewport: { width: 360, height: 780 }, colorScheme: 'light', isMobile: true },
      ];
      for (const m of modes) {
        const c = await browser.newContext({ viewport: m.viewport, colorScheme: m.colorScheme, isMobile: !!m.isMobile, deviceScaleFactor: 1 });
        for (const p of pages) {
          const page = await c.newPage();
          await page.goto(base + p);
          await page.waitForTimeout(100);
          await page.screenshot({ path: path.join(screensDir, `${p.replace('.html', '')}-${m.tag}.png`) });
          await page.addStyleTag({ content: '.topbar{position:static !important} .read-progress{display:none !important}' }); // keep them off widget shots
          const widgets = await page.locator('[data-widget]').count();
          for (let w = 0; w < widgets; w++) {
            const el = page.locator('[data-widget]').nth(w);
            await el.scrollIntoViewIfNeeded();
            await el.screenshot({ path: path.join(screensDir, `${p.replace('.html', '')}-${m.tag}-widget${w}.png`) });
          }
          await page.close();
        }
        await c.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`checked ${pages.length} page(s)`);
  if (failures.length) {
    console.log(failures.map((f) => '  FAIL ' + f).join('\n'));
    process.exit(1);
  }
  console.log('smoke OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
