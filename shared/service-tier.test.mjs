/**
 * 测试 shared/service-tier.js：normalizeServiceTier 仅接受 fast/flex。
 *
 * Keywords: service-tier, normalizeServiceTier, node:test
 *
 * Exports: 无导出 / 内含用例
 *
 * Inward: service-tier.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeServiceTier } from './service-tier.js';

test('normalizeServiceTier accepts only supported Codex service tiers', () => {
  assert.equal(normalizeServiceTier('fast'), 'fast');
  assert.equal(normalizeServiceTier('flex'), 'flex');
  assert.equal(normalizeServiceTier('standard'), null);
  assert.equal(normalizeServiceTier(''), null);
});
