import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP stdio: real client creates durable context and rejects stale writes', { timeout: 20000 }, async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'axon-mcp-'));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'server/mcp.ts'], cwd: root, env: { AXON_DB_PATH: path.join(dir, 'test.sqlite') }, stderr: 'pipe' });
  const client = new Client({ name: 'axon-integration-test', version: '1.0.0' });
  t.after(async () => { await client.close(); rmSync(dir, { recursive: true, force: true }); });
  await client.connect(transport);
  const listing = await client.listTools();
  assert.ok(listing.tools.some(tool => tool.name === 'get_handoff'));
  assert.ok(listing.tools.some(tool => tool.name === 'send_message'));
  assert.ok(listing.tools.some(tool => tool.name === 'get_resume_brief'));
  assert.ok(listing.tools.some(tool => tool.name === 'resolve_message_attention'));
  assert.ok(listing.tools.some(tool => tool.name === 'create_handoff_delivery'));
  assert.ok(listing.tools.some(tool => tool.name === 'get_handoff_deliveries'));
  assert.ok(listing.tools.some(tool => tool.name === 'acknowledge_handoff_delivery'));
  assert.ok(listing.tools.some(tool => tool.name === 'save_work_draft'));
  assert.ok(listing.tools.some(tool => tool.name === 'get_work_drafts'));
  assert.ok(listing.tools.some(tool => tool.name === 'discard_work_draft'));
  assert.ok(listing.tools.some(tool => tool.name === 'finalize_work'));
  assert.ok(listing.tools.some(tool => tool.name === 'reopen_task'));
  assert.ok(listing.tools.some(tool => tool.name === 'get_task_events'));
  assert.ok(listing.tools.some(tool => tool.name === 'create_backlog_item'));
  assert.ok(listing.tools.some(tool => tool.name === 'get_backlog'));
  assert.ok(listing.tools.some(tool => tool.name === 'update_backlog_item'));
  assert.ok(listing.tools.some(tool => tool.name === 'promote_backlog_item'));
  assert.ok(listing.tools.some(tool => tool.name === 'archive_backlog_item'));
  assert.equal(listing.tools.some(tool => tool.name === 'create_run' || tool.name === 'list_runs'), false);
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    const content = response.content as Array<{ type: string; text: string }>;
    return { response, data: JSON.parse(content[0].text) };
  };
  const { data: project } = await call('create_project', { name: 'Projeto MCP', objective: 'Retomar de outro agente' });
  assert.ok(project.id);
  const payload = { projectId: project.id, agent: 'Gemini', expectedRevision: 0, idempotencyKey: 'mcp-1', summary: 'Contrato preparado', nextStep: 'Executar revisão independente' };
  const saved = await call('save_checkpoint', payload);
  assert.equal(saved.response.isError, undefined);
  const stale = await call('save_checkpoint', { ...payload, idempotencyKey: 'mcp-2' });
  assert.equal(stale.response.isError, true);
  const handoff = await call('get_handoff', { projectId: project.id });
  assert.match(handoff.data.markdown, /Executar revisão independente/);
  assert.equal(handoff.data.revision, 1);
  const resume = await call('get_resume_brief', { projectId: project.id, agent: 'Gemini' });
  assert.equal(resume.response.isError, undefined);
  assert.equal(resume.data.revision, 1);
  assert.equal(resume.data.latestCheckpoint.nextStep, 'Executar revisão independente');
  assert.match(resume.data.markdown, /não confiável/i);
  const draft = await call('save_work_draft', {
    projectId: project.id,
    agent: 'Gemini',
    expectedVersion: 0,
    summary: 'Rascunho MCP ainda não entregue',
    nextAction: 'Confirmar que o checkpoint continua canônico',
  });
  assert.equal(draft.response.isError, undefined);
  assert.equal(draft.data.status, 'undelivered');
  const resumeWithDraft = await call('get_resume_brief', { projectId: project.id, agent: 'Gemini' });
  assert.equal(resumeWithDraft.data.workDraft.id, draft.data.id);
  assert.equal(resumeWithDraft.data.latestCheckpoint.nextStep, 'Executar revisão independente');
  assert.match(resumeWithDraft.data.markdown, /Rascunho não entregue/);
  const discarded = await call('discard_work_draft', {
    projectId: project.id,
    agent: 'Gemini',
    expectedVersion: 0,
  });
  assert.equal(discarded.response.isError, undefined);

  const targetTask = await call('create_task', {
    projectId: project.id,
    title: 'Foco explícito pela retomada',
  });
  assert.equal(targetTask.response.isError, undefined);
  const claimedTask = await call('claim_task', {
    projectId: project.id,
    taskId: targetTask.data.id,
    agent: 'Gemini',
    expectedVersion: targetTask.data.version,
  });
  assert.equal(claimedTask.response.isError, undefined);

  const automaticResume = await call('get_resume_brief', {
    projectId: project.id,
    agent: 'Gemini',
  });
  assert.equal(automaticResume.response.isError, undefined);
  assert.equal(automaticResume.data.focusTask.id, targetTask.data.id);

  const explicitAutomaticResume = await call('get_resume_brief', {
    projectId: project.id,
    agent: 'Gemini',
    focusMode: 'auto',
  });
  assert.equal(explicitAutomaticResume.response.isError, undefined);
  assert.equal(explicitAutomaticResume.data.focusTask.id, targetTask.data.id);

  const projectResume = await call('get_resume_brief', {
    projectId: project.id,
    agent: 'Gemini',
    focusMode: 'project',
  });
  assert.equal(projectResume.response.isError, undefined);
  assert.equal(projectResume.data.focusTask, null);

  const focusedResume = await call('get_resume_brief', {
    projectId: project.id,
    agent: 'Gemini',
    taskId: targetTask.data.id,
  });
  assert.equal(focusedResume.response.isError, undefined);
  assert.equal(focusedResume.data.focusTask.id, targetTask.data.id);

  const invalidTask = await call('get_resume_brief', {
    projectId: project.id,
    agent: 'Gemini',
    taskId: '',
  });
  assert.equal(invalidTask.response.isError, true);
  assert.equal(invalidTask.data.error.code, 'invalid_input');

  const { data: otherProject } = await call('create_project', {
    name: 'Outro projeto MCP',
    objective: 'Comprovar isolamento no transporte stdio',
  });
  const foreignTask = await call('create_task', {
    projectId: otherProject.id,
    title: 'Tarefa de outro projeto',
  });
  const foreignResume = await call('get_resume_brief', {
    projectId: project.id,
    agent: 'Gemini',
    taskId: foreignTask.data.id,
  });
  assert.equal(foreignResume.response.isError, true);
  assert.equal(foreignResume.data.error.code, 'not_found');

  const conflictingResume = await call('get_resume_brief', {
    projectId: project.id,
    agent: 'Gemini',
    taskId: targetTask.data.id,
    focusMode: 'project',
  });
  assert.equal(conflictingResume.response.isError, true);
  assert.equal(conflictingResume.data.error.code, 'invalid_input');

  const attentionMessage = await call('send_message', {
    projectId: project.id,
    from: 'Astra',
    to: 'Gemini',
    kind: 'question',
    body: 'O checkpoint está pronto para continuidade?',
  });
  assert.equal(attentionMessage.response.isError, undefined);
  const attentionResolution = await call('resolve_message_attention', {
    projectId: project.id,
    messageId: attentionMessage.data.id,
    agent: 'Gemini',
    note: 'Sim, a retomada foi conferida.',
  });
  assert.equal(attentionResolution.response.isError, undefined);
  assert.equal(attentionResolution.data.messageId, attentionMessage.data.id);

  const inboxAfterResolution = await call('get_inbox', {
    projectId: project.id,
    agent: 'Gemini',
  });
  const resolvedInboxItem = inboxAfterResolution.data.find(
    (item: { message: { id: string } }) => item.message.id === attentionMessage.data.id,
  );
  assert.equal(resolvedInboxItem.acknowledgedAt, null);
  assert.equal(
    resolvedInboxItem.resolution.resolvedAt,
    attentionResolution.data.resolvedAt,
  );
  const resumeAfterResolution = await call('get_resume_brief', {
    projectId: project.id,
    agent: 'Gemini',
  });
  assert.equal(
    resumeAfterResolution.data.attention.some(
      (item: { sourceId: string }) => item.sourceId === attentionMessage.data.id,
    ),
    false,
  );

  const resolutionRetry = await call('resolve_message_attention', {
    projectId: project.id,
    messageId: attentionMessage.data.id,
    agent: 'Gemini',
    note: 'Sim, a retomada foi conferida.',
  });
  assert.deepEqual(resolutionRetry.data, attentionResolution.data);

  const createdDelivery = await call('create_handoff_delivery', {
    projectId: project.id,
    checkpointId: saved.data.id,
    from: 'Gemini',
    to: 'Grok',
    message: 'Revise o contrato antes de assumir.',
  });
  assert.equal(createdDelivery.response.isError, undefined);
  assert.equal(createdDelivery.data.to, 'Grok');
  assert.equal(createdDelivery.data.checkpointId, saved.data.id);

  const mismatch = await call('create_handoff_delivery', {
    projectId: project.id,
    checkpointId: saved.data.id,
    from: 'Grok',
    to: 'Astra',
    message: 'Autor divergente.',
  });
  assert.equal(mismatch.response.isError, true);
  assert.equal(mismatch.data.error.code, 'handoff_author_mismatch');

  const listed = await call('get_handoff_deliveries', { projectId: project.id, agent: 'Grok' });
  assert.equal(listed.response.isError, undefined);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].id, createdDelivery.data.id);

  const acked = await call('acknowledge_handoff_delivery', {
    projectId: project.id,
    deliveryId: createdDelivery.data.id,
    agent: 'Grok',
  });
  assert.equal(acked.response.isError, undefined);
  assert.equal(acked.data.deliveryId, createdDelivery.data.id);
  const unread = await call('get_handoff_deliveries', { projectId: project.id, agent: 'Grok', unreadOnly: true });
  assert.equal(unread.data.length, 0);

  const idea = await call('create_backlog_item', {
    projectId: project.id,
    title: 'Ideia MCP',
    createdBy: 'Gemini',
    stage: 'ready',
  });
  assert.equal(idea.response.isError, undefined);
  assert.equal(idea.data.title, 'Ideia MCP');
  const listedBacklog = await call('get_backlog', { projectId: project.id });
  assert.equal(listedBacklog.data.length, 1);
  const promoted = await call('promote_backlog_item', { projectId: project.id, itemId: idea.data.id });
  assert.equal(promoted.response.isError, undefined);
  assert.equal(promoted.data.task.title, 'Ideia MCP');
  const exported = await call('export_project_bundle', { projectId: project.id });
  // Sem versao declarada o MCP entrega a memoria completa, igual ao HTTP e a interface.
  assert.equal(exported.data.version, 3);
  assert.equal(exported.data.backlogItems.some((item: { id: string }) => item.id === idea.data.id), true);
  assert.equal(exported.data.deliveries.length, 1);
});
