import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceStore } from '../server/store.js';

test('mensagens no mesmo milissegundo mantêm ordem de gravação no projeto e na inbox', () => {
  const store = new WorkspaceStore(':memory:', { now: () => new Date('2026-09-14T12:00:00Z') });
  try {
    const project = store.createProject({ name: 'Ordem durável', objective: 'Preservar mensagem mais recente' });
    const expected: string[] = [];
    for (let i = 0; i < 35; i++) {
      expected.push(store.postMessage(project.id, { from: 'Astra', to: 'Grok', kind: 'note', body: 'Registro ' + i }).id);
    }
    assert.deepEqual(store.getProject(project.id).messages.map(m => m.id), expected);
    assert.deepEqual(store.getInbox(project.id, 'Grok').map(item => item.message.id), expected);
  } finally { store.close(); }
});
