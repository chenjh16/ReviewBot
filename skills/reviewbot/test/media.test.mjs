import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initMedia } from '../lib/util/media.mjs';

describe('initMedia', () => {
  it('initializes without error', () => {
    initMedia('/fake/chrome');
  });

  it('accepts null config path', () => {
    initMedia(null);
  });
});
