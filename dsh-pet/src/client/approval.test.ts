import assert from 'node:assert/strict';
import test from 'node:test';
import { jsx } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeApprovalCard } from './approval';

const item = {
  id: 'approval-1',
  toolName: 'bash',
  reason: '允许本次操作使用 danger-full-access 权限：清理构建缓存',
  detail: 'Remove-Item -Recurse -Force .\\dist\\*',
  sessionId: 'session-demo-9f3a2c',
  createdAt: 0,
};

test('approval card renders title, tool, reason, detail, queue and two decisions', () => {
  const Card = makeApprovalCard(jsx);
  const html = renderToStaticMarkup(
    jsx(Card, { item, count: 2, busy: false, error: '', onAnswer: () => {} }),
  );
  assert.match(html, /需要你的授权/);
  assert.match(html, /bash/);
  assert.match(html, /danger-full-access/);
  assert.match(html, /Remove-Item/);
  assert.match(html, /还有 1 条待处理/);
  assert.match(html, />拒绝</);
  assert.match(html, />同意</);
  assert.match(html, /同意仅对本次操作生效/);
});

test('busy and error states disable both buttons and surface the error', () => {
  const Card = makeApprovalCard(jsx);
  const html = renderToStaticMarkup(
    jsx(Card, { item, count: 1, busy: true, error: '提交失败，请重试', onAnswer: () => {} }),
  );
  assert.match(html, /is-answering/);
  assert.match(html, /is-error/);
  assert.match(html, /提交失败，请重试/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
});
