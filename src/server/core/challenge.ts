// Anti-robot checks (Cloudflare, DataDome, PerimeterX, Imperva…) stand between some pages and automated tools such
// as Glaneur. They are not circumvented: Glaneur recognises their pages and says so, rather than reading them as
// content.

export class ChallengeError extends Error {
  constructor() {
    super(
      'Ce site demande une vérification anti-robot (Cloudflare ou équivalent) avant d’afficher la page : Glaneur ne la contourne pas. Cherchez plutôt un flux officiel du site ou une route RSSHub.',
    );
    this.name = 'ChallengeError';
  }
}

// Markers of the check pages themselves, not of the scripts these services also add to ordinary pages.
const MARKERS = [
  /window\._cf_chl_opt|id="challenge-(?:form|running|error-text)"/i, // Cloudflare challenge
  /<title>\s*(?:Just a moment|Un instant|Nur einen Moment|Un momento|Attention Required)/i, // Cloudflare pages
  /id="cf-error-details"|Sorry, you have been blocked/i, // Cloudflare block
  /var dd=\{['"]?rt['"]?:|geo\.captcha-delivery\.com\/(?:captcha|interstitial)/i, // DataDome
  /id="px-captcha"/i, // PerimeterX (HUMAN)
  /Incapsula incident ID/i, // Imperva
];

export function isChallengePage(html: string): boolean {
  // Check pages are small; ordinary pages that merely carry these services' scripts are far larger.
  if (html.length > 150_000) return false;
  return MARKERS.some((re) => re.test(html));
}

/** Same test inside a browser page, evaluated as a string (the server is compiled without DOM types). */
export const CHALLENGE_SHOWN = `Boolean(window._cf_chl_opt
  || document.querySelector('#challenge-form, #challenge-running, #px-captcha, iframe[src*="captcha-delivery.com"]')
  || /^(just a moment|un instant|nur einen moment|un momento)/i.test(document.title))`;
