import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToStyledHtml, detectChromePath } from '../lib/util/render.mjs';

describe('markdownToStyledHtml', () => {
  it('returns a complete HTML document', () => {
    const html = markdownToStyledHtml('# Hello');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
    assert.ok(html.includes('<div class="card">'));
  });

  it('renders markdown into HTML', () => {
    const html = markdownToStyledHtml('**bold**');
    assert.ok(html.includes('<strong>'));
  });

  it('includes CurBot footer', () => {
    const html = markdownToStyledHtml('test');
    assert.ok(html.includes('CurBot'));
  });

  it('includes responsive viewport', () => {
    const html = markdownToStyledHtml('x');
    assert.ok(html.includes('viewport'));
  });
});

describe('detectChromePath', () => {
  it('returns config path when provided', () => {
    assert.equal(detectChromePath('/custom/chrome'), '/custom/chrome');
  });

  it('returns a string when no config path', () => {
    const path = detectChromePath(null);
    assert.ok(typeof path === 'string');
    assert.ok(path.length > 0);
  });
});
