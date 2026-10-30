import assert from 'node:assert/strict';
import test from 'node:test';
import { ApprovalBroker, truncateDetail } from './approval';

test('request publishes FIFO views and answer resolves + clears', async () => {
  const snapshots: string[][] = [];
  const broker = new ApprovalBroker((views) => snapshots.push(views.map((v) => v.id)));
  const first = broker.request({ toolName: 'bash', reason: '允许本次操作使用 danger-full-access 权限：删除临时文件' });
  const second = broker.request({ toolName: 'edit', reason: '写文件' });
  assert.equal(broker.views().length, 2);
  assert.deepEqual(snapshots.at(-1)?.length, 2);

  const id = broker.views()[0]?.id ?? '';
  assert.equal(broker.answer(id, 'allowed-once').ok, true);
  assert.equal(await first, 'allowed-once');
  assert.equal(broker.views().length, 1);
  assert.equal(broker.views()[0]?.toolName, 'edit');
  assert.equal(broker.answer(id, 'rejected').ok, false);
  assert.equal(broker.answer(id, 'rejected').reason, 'stale');

  const secondId = broker.views()[0]?.id ?? '';
  assert.equal(broker.answer(secondId, 'rejected').ok, true);
  assert.equal(await second, 'rejected');
  assert.equal(broker.views().length, 0);
});

test('aborted request resolves cancelled and leaves the queue', async () => {
  const broker = new ApprovalBroker(() => {});
  const controller = new AbortController();
  const pending = broker.request({ toolName: 'bash', reason: 'x', signal: controller.signal });
  assert.equal(broker.views().length, 1);
  controller.abort();
  assert.equal(await pending, 'cancelled');
  assert.equal(broker.views().length, 0);
});

test('displayReason prefers zh and falls back to reason', async () => {
  const broker = new ApprovalBroker(() => {});
  const localized = broker.request({
    toolName: 'bash',
    reason: 'escalate sandbox to danger-full-access: cleanup',
    displayReason: { zh: '允许本次操作使用 danger-full-access 权限：清理', en: 'Allow this operation' },
  });
  assert.equal(broker.views()[0]?.reason, '允许本次操作使用 danger-full-access 权限：清理');
  broker.cancelAll();
  assert.equal(await localized, 'cancelled');

  const raw = broker.request({ toolName: 'bash', reason: 'escalate sandbox to workspace-write' });
  assert.equal(broker.views()[0]?.reason, 'escalate sandbox to workspace-write');
  broker.cancelAll();
  assert.equal(await raw, 'cancelled');
});

test('queue is bounded; overflow fails closed', async () => {
  const broker = new ApprovalBroker(() => {});
  const held = [];
  for (let i = 0; i < 8; i += 1) held.push(broker.request({ toolName: 'bash', reason: `第 ${i} 条` }));
  assert.equal(broker.views().length, 8);
  assert.equal(await broker.request({ toolName: 'bash', reason: '第 9 条' }), 'unavailable');
  broker.cancelAll();
  for (const p of held) assert.equal(await p, 'cancelled');
  assert.equal(broker.views().length, 0);
});

test('truncateDetail caps by code points and appends an ellipsis', () => {
  assert.equal(truncateDetail('abc'), 'abc');
  const long = '界'.repeat(601);
  const cut = truncateDetail(long);
  assert.equal(Array.from(cut).length, 601);
  assert.equal(cut.endsWith('…'), true);
});
