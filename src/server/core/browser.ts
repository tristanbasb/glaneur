// Headless Chromium rendering for JavaScript-heavy pages (optional: needs a system Chromium).
import fs from 'node:fs';
import puppeteer, { type Browser, type BrowserContext, type CookieData, type Page } from 'puppeteer-core';
import { PAGE_WIDTH, type RenderOptions, type RequestOptions } from '../../shared/types.js';
import { config } from '../config.js';
import { getSettings } from '../settings.js';
import { HttpError, log, Semaphore } from '../util.js';
import { type ConsentAction, consentScript, settleConsent } from './autoconsent.js';
import { consentCookies, cookieHeaderFor, leftAfterConsent } from './consent.js';

const CANDIDATES: Record<string, string[]> = {
  linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/snap/bin/chromium'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  win32: [
    `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

let resolvedPath: string | null | undefined;

export function browserPath(): string | null {
  if (resolvedPath !== undefined) return resolvedPath;
  const list = config.chromiumPath ? [config.chromiumPath] : (CANDIDATES[process.platform] ?? []);
  resolvedPath =
    list.find((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    }) ?? null;
  return resolvedPath;
}

// Some Windows launchers pass on __COMPAT_LAYER (compatibility mode): Chrome and Edge then exit immediately.
function browserEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== '__COMPAT_LAYER'));
}

const semaphore = new Semaphore(config.browserConcurrency);
let browserPromise: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let activeRenders = 0;

async function getBrowser(): Promise<Browser> {
  const executablePath = browserPath();
  if (!executablePath) {
    throw new Error('Rendu JavaScript indisponible : aucun Chromium installé sur le serveur (voir la documentation).');
  }
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        executablePath,
        env: browserEnv(),
        headless: true,
        defaultViewport: { width: PAGE_WIDTH, height: 900 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--mute-audio',
          '--hide-scrollbars',
          '--disable-extensions',
          '--disable-background-networking',
          // Keeps third-party frames (consent popups often live in one) in the page's process, where the consent
          // script is injected. Isolation matters little in a throwaway context, and it saves memory.
          '--disable-site-isolation-trials',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      })
      .then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        log.info('Chromium démarré');
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (activeRenders > 0 || !browserPromise) return;
    const pending = browserPromise;
    browserPromise = null;
    pending
      .then((b) => b.close())
      .then(() => log.info('Chromium arrêté (inactif)'))
      .catch(() => undefined);
  }, 3 * 60_000);
  idleTimer.unref();
}

/** Runs a task with the shared browser, one context at a time per slot, and closes the browser once idle. */
function withBrowser<T>(task: (browser: Browser) => Promise<T>): Promise<T> {
  return semaphore.use(async () => {
    activeRenders++;
    try {
      return await task(await getBrowser());
    } finally {
      activeRenders--;
      scheduleIdleClose();
    }
  });
}

function parseCookies(header: string, url: string): CookieData[] {
  const domain = new URL(url).hostname;
  return header
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes('='))
    .map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain, path: '/' };
    });
}

/** A page set up like a visitor's: user agent, languages, headers and cookies (the user's, then consent choices). */
async function openPage(context: BrowserContext, url: string, request: RequestOptions | undefined, lightweight: boolean): Promise<Page> {
  const page = await context.newPage();
  const settings = getSettings();
  await page.setUserAgent({ userAgent: request?.userAgent || settings.userAgent });
  const headers: Record<string, string> = { 'accept-language': settings.acceptLanguage };
  for (const [k, v] of Object.entries(request?.headers ?? {})) if (k.trim() && v) headers[k.trim().toLowerCase()] = v;
  await page.setExtraHTTPHeaders(headers);
  const own = request?.cookies ? parseCookies(request.cookies, url) : [];
  const consent = consentCookies(url).filter((c) => !own.some((o) => o.name === c.name));
  if (own.length || consent.length) await context.setCookie(...own, ...consent.map((c) => ({ ...c, path: '/' })));
  await page.setRequestInterception(true);
  // Pages mark images as loaded and lay out around them and their fonts: skip those only when nobody looks.
  page.on('request', (req) => {
    const type = req.resourceType();
    if (type === 'media' || (lightweight && (type === 'image' || type === 'font'))) req.abort().catch(() => undefined);
    else req.continue().catch(() => undefined);
  });
  return page;
}

const SCROLL_SCRIPT = `(async () => {
  for (let i = 0; i < 6; i++) {
    window.scrollBy(0, window.innerHeight);
    await new Promise((r) => setTimeout(r, 350));
  }
  window.scrollTo(0, 0);
})()`;

export interface RenderResult {
  html: string;
  finalUrl: string;
  status: number;
  /** How the consent popup was answered, if there was one. */
  consent: string | null;
}

interface RenderJob {
  browser: Browser;
  url: string;
  render: RenderOptions;
  request?: RequestOptions;
  lightweight: boolean;
}

/** One render in a fresh browser context. Refusing cookies may send the page elsewhere: the render then gives up. */
function renderIn(job: RenderJob, action: 'optOut'): Promise<RenderResult | null>;
function renderIn(job: RenderJob, action: 'optIn'): Promise<RenderResult>;
async function renderIn({ browser, url, render, request, lightweight }: RenderJob, action: ConsentAction): Promise<RenderResult | null> {
  const context = await browser.createBrowserContext();
  try {
    const page = await openPage(context, url, request, lightweight);
    await page.evaluateOnNewDocument(consentScript(action));
    // The consent popup may be answered while the page is still loading, and the answer may replace the document:
    // remember the first one the browser showed.
    let firstDocument: string | null = null;
    page.on('framenavigated', (frame) => {
      if (!firstDocument && frame === page.mainFrame()) firstDocument = frame.url();
    });

    const timeout = (request?.timeoutSec ?? 35) * 1000;
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout });
    const status = response?.status() ?? 200;
    const answered = await settleConsent(page);
    const before: string = firstDocument ?? url;
    if (action === 'optOut' && leftAfterConsent(url, before, page.url())) return null;
    if (render.waitFor) await page.waitForSelector(render.waitFor, { timeout: 15_000 }).catch(() => undefined);
    if (render.scroll) await page.evaluate(SCROLL_SCRIPT).catch(() => undefined);
    if (render.delayMs) await new Promise((r) => setTimeout(r, Math.min(render.delayMs ?? 0, 15_000)));
    // A consent answer may reload the page: read it once the new document has settled.
    const html = await page.content().catch(async () => {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
      return page.content();
    });
    if (status >= 400 && html.length < 3000) throw new HttpError(status, url);
    return { html, finalUrl: page.url(), status, consent: answered };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function renderPage(url: string, render: RenderOptions, request?: RequestOptions, opts: { lightweight?: boolean } = {}): Promise<RenderResult> {
  return withBrowser(async (browser) => {
    const job: RenderJob = { browser, url, render, request, lightweight: !!opts.lightweight };
    // Cookies are refused first. Some sites answer a refusal with their subscription page: then start over,
    // accepting them.
    return (await renderIn(job, 'optOut')) ?? (await renderIn(job, 'optIn'));
  });
}

// Evaluated as strings: the server is compiled without DOM types.
const clickSelector = (selector: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  el.click();
  return true;
})()`;
const clickText = (text: string) => `(() => {
  const want = ${JSON.stringify(text.replace(/\s+/g, ' ').trim().toLowerCase())};
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  for (const el of document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')) {
    if (norm(el.innerText || el.value || el.getAttribute('aria-label')) === want) {
      el.click();
      return true;
    }
  }
  return false;
})()`;

/** Clicks the element designated in the editor, found by its selector or, failing that, by its label. */
async function clickTarget(page: Page, { selector, text }: { selector: string; text: string }): Promise<boolean> {
  // Popups often appear a moment after the page has loaded.
  if (selector) await page.waitForSelector(selector, { timeout: 8000 }).catch(() => undefined);
  if (selector && (await page.evaluate(clickSelector(selector)).catch(() => false))) return true;
  if (!text) return false;
  for (const frame of page.frames()) {
    if (await frame.evaluate(clickText(text)).catch(() => false)) return true;
  }
  return false;
}

/**
 * Clicks a button of the page the way a visitor would (a consent banner's, say), and returns the cookies that then
 * apply to the page: sent with every later fetch, they let the feed see what the visitor saw.
 */
export function clickThrough(url: string, request: RequestOptions | undefined, target: { selector: string; text: string }): Promise<{ cookies: string; finalUrl: string }> {
  return withBrowser(async (browser) => {
    const context = await browser.createBrowserContext();
    try {
      const page = await openPage(context, url, request, false);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: (request?.timeoutSec ?? 35) * 1000 });
      if (!(await clickTarget(page, target))) {
        throw new Error('Glaneur ne retrouve pas ce bouton dans la page qu’il a chargée : relisez la page, puis cliquez de nouveau.');
      }
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 10_000 }).catch(() => undefined);
      return { cookies: cookieHeaderFor(await context.cookies(), url), finalUrl: page.url() };
    } finally {
      await context.close().catch(() => undefined);
    }
  });
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  await pending.then((b) => b.close()).catch(() => undefined);
}
