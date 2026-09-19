// Consent walls: cookies that let pages show directly, and banners hidden in the visual selector.

export interface ConsentCookie {
  name: string;
  value: string;
  domain: string;
}

/** Google and YouTube redirect to consent.* until a consent choice is stored in a cookie. */
function consentDomain(host: string): string | null {
  if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(host)) return '.youtube.com';
  const google = /(?:^|\.)(google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2}))$/i.exec(host);
  return google ? `.${google[1].toLowerCase()}` : null;
}

export function consentCookies(url: string): ConsentCookie[] {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return [];
  }
  const domain = consentDomain(host);
  return domain ? [{ name: 'SOCS', value: 'CAI', domain }, { name: 'CONSENT', value: 'YES+cb', domain }] : [];
}

/** Cookie header for a request: the user's cookies, then the consent cookies they don't already set. */
export function cookieHeader(url: string, userCookies?: string): string | undefined {
  const pairs = (userCookies ?? '').split(';').map((p) => p.trim()).filter((p) => p.includes('='));
  const names = new Set(pairs.map((p) => p.slice(0, p.indexOf('=')).trim()));
  for (const c of consentCookies(url)) if (!names.has(c.name)) pairs.push(`${c.name}=${c.value}`);
  return pairs.length ? pairs.join('; ') : undefined;
}

const WALL_HOST = /^(consent|accounts|login|auth|signin|guce)\./i;
const WALL_PATH = /\/(consent|collectconsent|login|signin|sign-in|connexion)(\/|$)/i;

/** Host of the consent or login page an address was redirected to, if any. */
export function wallRedirect(url: string, finalUrl: string): string | null {
  let from: URL;
  let to: URL;
  try {
    from = new URL(url);
    to = new URL(finalUrl);
  } catch {
    return null;
  }
  if (from.hostname === to.hostname && from.pathname === to.pathname) return null;
  if (WALL_HOST.test(to.hostname) || (WALL_PATH.test(to.pathname) && !WALL_PATH.test(from.pathname))) return to.hostname;
  return null;
}

/** Same path on the same site: www.yahoo.com/ and fr.yahoo.com/?p=us are one page, a language redirect apart. */
function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const site = (u: URL) => u.hostname.split('.').slice(-2).join('.');
    const route = (u: URL) => u.pathname.replace(/\/+$/, '');
    return site(x) === site(y) && route(x) === route(y);
  } catch {
    return a === b;
  }
}

/**
 * Answering the consent popup sent the browser to another page (a "refuse and subscribe" wall), instead of
 * back from a consent page to the one requested.
 */
export function leftAfterConsent(requested: string, before: string, after: string): boolean {
  if (samePage(before, after) || samePage(requested, after)) return false;
  return !wallRedirect(requested, before);
}

/** Root elements of common consent managers: they cover the page, and their buttons need scripts. */
export const CONSENT_BANNERS = [
  '#didomi-host', // Didomi
  '#onetrust-consent-sdk', // OneTrust
  '[id^="sp_message_container"]', // Sourcepoint
  '#qc-cmp2-container', // InMobi Choice
  '#axeptio_overlay', // Axeptio
  '#usercentrics-root',
  '#usercentrics-cmp-ui', // Usercentrics
  '#CybotCookiebotDialog',
  '#CybotCookiebotDialogBodyUnderlay', // Cookiebot
  '#tarteaucitronRoot', // tarteaucitron
  '#cmpbox',
  '#cmpbox2', // consentmanager
  '.fc-consent-root', // Google Funding Choices
  '#truste-consent-track',
  '.truste_overlay',
  '.truste_box_overlay', // TrustArc
  '#popin_tc_privacy',
  '#footer_tc_privacy',
  '#privacy-overlay', // Commanders Act
  '#appconsent', // AppConsent
  '#sd-cmp', // Sirdata
  '#cmplz-cookiebanner-container', // Complianz
  '.cky-consent-container',
  '.cky-overlay', // CookieYes
  '#cookie-law-info-bar', // GDPR Cookie Consent
  '#iubenda-cs-banner', // iubenda
  '#BorlabsCookieBox', // Borlabs
  '#moove_gdpr_cookie_info_bar', // GDPR Cookie Compliance
  '#cookiescript_injected', // Cookie-Script
  '#hs-eu-cookie-confirmation', // HubSpot
  '#ez-cookie-dialog-wrapper', // Ezoic
  '.osano-cm-window', // Osano
  '.cc-window', // Cookie Consent
  '.klaro', // Klaro
];

/** Classes that banners put on <html> or <body> to stop the page from scrolling. */
export const SCROLL_LOCK_CLASS = /(^|[-_])(no-?scroll|overflow-hidden|scroll-?lock(ed)?|popup-open|modal-open|message-open|ui-showing)$/i;
