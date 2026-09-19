import { describe, expect, it } from 'vitest';
import { isChallengePage } from '../src/server/core/challenge.js';

describe('anti-robot checks', () => {
  it('recognises check pages', () => {
    expect(isChallengePage(`<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={cvId:'3'}</script></body></html>`)).toBe(true);
    expect(isChallengePage(`<html><head><title>Un instant…</title></head><body></body></html>`)).toBe(true);
    expect(isChallengePage(`<html><body><script>var dd={'rt':'c','cid':'x'}</script><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>`)).toBe(true);
    expect(isChallengePage(`<html><body><div id="px-captcha"></div></body></html>`)).toBe(true);
  });

  it('leaves alone ordinary pages that carry these services’ scripts', () => {
    const page = `<html><head><title>Actualités</title></head><body><article>Texte</article>
<script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/abc/main.js"></script><script>window.__CF$cv$params={r:'1'}</script>
<script src="https://js.datadome.co/tags.js"></script></body></html>`;
    expect(isChallengePage(page)).toBe(false);
  });
});
