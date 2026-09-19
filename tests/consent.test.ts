import { describe, expect, it } from 'vitest';
import { consentCookies, cookieHeader, leftAfterConsent, wallRedirect } from '../src/server/core/consent.js';
import { prepareViewHtml } from '../src/server/view.js';

describe('consent walls', () => {
  it('stores a consent choice for Google and YouTube only', () => {
    expect(consentCookies('https://www.youtube.com/@x/videos').map((c) => c.domain)).toEqual(['.youtube.com', '.youtube.com']);
    expect(consentCookies('https://youtu.be/abc')[0]?.domain).toBe('.youtube.com');
    expect(consentCookies('https://news.google.fr/')[0]?.domain).toBe('.google.fr');
    expect(consentCookies('https://example.com/')).toEqual([]);
  });

  it('keeps the user’s own cookies', () => {
    expect(cookieHeader('https://www.youtube.com/', 'SOCS=mine; a=1')).toBe('SOCS=mine; a=1; CONSENT=YES+cb');
    expect(cookieHeader('https://example.com/', ' a=1; ')).toBe('a=1');
    expect(cookieHeader('https://example.com/')).toBeUndefined();
  });

  it('spots redirects to consent and login pages', () => {
    expect(wallRedirect('https://www.youtube.com/@x', 'https://consent.youtube.com/m?continue=x')).toBe('consent.youtube.com');
    expect(wallRedirect('https://site.fr/compte', 'https://site.fr/login?next=/compte')).toBe('site.fr');
    expect(wallRedirect('http://lemonde.fr/', 'https://www.lemonde.fr/')).toBeNull();
  });

  it('tells a refusal that leads elsewhere from leaving a consent page', () => {
    expect(leftAfterConsent('https://www.20minutes.fr/', 'https://www.20minutes.fr/', 'https://membre.20minutes.fr/abonnement/inscription/')).toBe(true);
    expect(leftAfterConsent('https://www.yahoo.com/', 'https://consent.yahoo.com/v2/collectConsent?sessionId=1', 'https://fr.yahoo.com/?guccounter=1')).toBe(false);
    expect(leftAfterConsent('https://site.fr/actus', 'https://site.fr/actus', 'https://www.site.fr/actus/?utm=1')).toBe(false);
    expect(leftAfterConsent('https://www.yahoo.com/', 'https://www.yahoo.com/', 'https://fr.yahoo.com/?p=us')).toBe(false);
  });

  it('hides consent banners in the visual selector without changing the page structure', () => {
    const html =
      '<html><body class="home didomi-popup-open" style="overflow: hidden;"><div id="didomi-host"><p>Cookies ?</p></div><div class="list"><a href="/a">A</a></div></body></html>';
    const view = prepareViewHtml(html, 'https://site.fr/');
    expect(view).toContain('<div id="didomi-host" style="display: none !important">');
    expect(view).toContain('<body class="home">');
    expect(view).not.toMatch(/overflow/);
  });

  it('leaves pages without a banner untouched', () => {
    const view = prepareViewHtml('<html><body class="modal-open" style="overflow: hidden"><p>Texte</p></body></html>', 'https://site.fr/');
    expect(view).toContain('<body class="modal-open" style="overflow: hidden">');
  });
});
