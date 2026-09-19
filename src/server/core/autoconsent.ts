// Answers cookie consent popups during Chromium renders, with DuckDuckGo's autoconsent rules (several hundred
// consent managers, plus a heuristic for unknown ones). Optional cookies are refused when the site allows it, and
// accepted when it does not (cookie walls): each render uses a throwaway browser context, so no choice lingers.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Frame, Page } from 'puppeteer-core';
import { log, sleep } from '../util.js';

export type ConsentAction = 'optOut' | 'optIn';

const require = createRequire(import.meta.url);
let source: string | null = null;
const scripts = new Map<ConsentAction, string>();

/** Self-contained autoconsent build, injected in every frame before the page's own scripts. */
export function consentScript(action: ConsentAction): string {
  const cached = scripts.get(action);
  if (cached) return cached;
  source ??= fs.readFileSync(path.join(path.dirname(require.resolve('@duckduckgo/autoconsent')), 'autoconsent.standalone.js'), 'utf8');
  let script = source;
  if (action === 'optIn') {
    // The standalone build refuses by default; its settings are a literal that can take the action.
    script = source.replace(/(if \(!window\.autoconsentReceiveMessage\) \{\s*const config = \{)/, '$1 autoAction: "optIn",');
    if (script === source) log.warn('autoconsent : réglage introuvable, les cookies seront seulement refusés.');
  }
  scripts.set(action, script);
  return script;
}

interface FrameConsent {
  lifecycle: string;
  cmp: string | null;
  optOut: boolean | null;
  optIn: boolean | null;
}

// Evaluated as strings: the server is compiled without DOM types.
const READ_STATE = `(() => {
  const ac = window.autoconsentStandalone;
  if (!ac || !ac.instance) return null;
  const last = (type) => {
    for (let i = ac.messages.length - 1; i >= 0; i--) if (ac.messages[i].type === type) return ac.messages[i];
    return null;
  };
  const popup = last('popupFound');
  const optOut = last('optOutResult');
  const optIn = last('optInResult');
  return {
    lifecycle: (ac.instance.state && ac.instance.state.lifecycle) || '',
    cmp: popup ? String(popup.cmp) : null,
    optOut: optOut ? Boolean(optOut.result) : null,
    optIn: optIn ? Boolean(optIn.result) : null,
  };
})()`;
const OPT_IN = `(() => { window.autoconsentStandalone.instance.receiveMessageCallback({ type: 'optIn' }); return true; })()`;

/** A popup is on screen or being answered. */
const ACTIVE = new Set(['openPopupDetected', 'runningOptOut', 'runningOptIn']);
/** Still looking for a consent manager or waiting for its popup. */
const DETECTING = new Set(['loading', 'initialized', 'waitingForInitResponse', 'started', 'cmpDetected']);
const DETECT_GRACE_MS = 2500;

function readFrame(frame: Frame): Promise<FrameConsent | null> {
  return frame.evaluate(READ_STATE).then((v) => (v as FrameConsent | null) ?? null, () => null);
}

/**
 * Waits until the page's consent popup, if any, has been answered, then lets the page load what the answer unlocks.
 * Returns what happened ("didomi : refusé"), or null when no popup was answered.
 */
export async function settleConsent(page: Page, budgetMs = 9000): Promise<string | null> {
  const start = Date.now();
  const acceptAsked = new Set<Frame>();
  let outcome: string | null = null;
  while (Date.now() - start < budgetMs) {
    const frames = page.frames().filter((f) => /^https?:/i.test(f.url()));
    const states = await Promise.all(frames.map(async (frame) => ({ frame, state: await readFrame(frame) })));
    let pending = false;
    for (const { frame, state } of states) {
      if (!state) continue;
      if (state.cmp) {
        if (state.optIn) outcome = `${state.cmp} : accepté`;
        else if (state.optOut) outcome = `${state.cmp} : refusé`;
      }
      // No way to refuse (a cookie wall): accept, or the content stays hidden.
      if (state.optOut === false && state.cmp && !acceptAsked.has(frame)) {
        acceptAsked.add(frame);
        await frame.evaluate(OPT_IN).catch(() => undefined);
        pending = true;
        continue;
      }
      if (ACTIVE.has(state.lifecycle) || (acceptAsked.has(frame) && state.optIn === null)) pending = true;
      else if (DETECTING.has(state.lifecycle) && Date.now() - start < DETECT_GRACE_MS) pending = true;
    }
    if (!pending) break;
    await sleep(250);
  }
  if (outcome) await page.waitForNetworkIdle({ idleTime: 500, timeout: 6000 }).catch(() => undefined);
  return outcome;
}
