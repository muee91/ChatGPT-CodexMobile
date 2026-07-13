import assert from 'node:assert/strict';
import test from 'node:test';
import { detectFeishuSkillKeys } from './feishu-skills.js';

test('detectFeishuSkillKeys does not treat mobile wording as drive operations', () => {
  assert.deepEqual(detectFeishuSkillKeys('移动端自动化发送测试，请忽略。'), []);
});

test('detectFeishuSkillKeys still detects explicit drive move requests', () => {
  assert.deepEqual(detectFeishuSkillKeys('把这个文件移动到项目文件夹'), ['drive']);
});
