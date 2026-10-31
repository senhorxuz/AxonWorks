import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

async function newProject(page: Page, name: string, workspacePath?: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
  await modal.getByLabel('Nome do projeto').fill(name);
  await modal.getByLabel('Objetivo', { exact: true }).fill('Preservar decisões e continuar o trabalho entre agentes.');
  if (workspacePath) await modal.getByLabel('Pasta do projeto (opcional)').fill(workspacePath);
  await modal.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Nome do agente').fill('Astra');
  return page.url();
}

async function openCheckpoint(page: Page) {
  await page.getByRole('tab', { name: /^Checkpoints/ }).click();
  await page.getByRole('button', { name: 'Novo checkpoint', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Salvar checkpoint', exact: true });
  await expect(modal).toBeVisible();
  return modal;
}

test('biblioteca guarda revisão vigente e busca só o texto atual', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await newProject(page, 'Memória compartilhada');
  await page.getByRole('tab', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Novo conteúdo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo conteúdo', exact: true });
  await dialog.getByLabel('Título').fill('Contrato de continuidade');
  await dialog.getByLabel('Texto do conteúdo').fill('A Axon funciona como correio entre IAs.');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Contrato de continuidade', exact: true })).toBeVisible();
  await expect(page.getByText('A Axon funciona como correio entre IAs.')).toBeVisible();
  await page.getByLabel('Buscar na revisão vigente').fill('correio');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('button', { name: /Contrato de continuidade/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('library.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('jornada real: projeto, tarefa, checkpoint, mensagem, exportação e persistência', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const name = 'Continuidade orbital';
  await newProject(page, name);
  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByLabel('Título da tarefa').fill('Preparar o próximo agente');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  const task = page.locator('article.task').filter({ hasText: 'Preparar o próximo agente' });
  await task.getByRole('button', { name: 'Assumir tarefa', exact: true }).click();
  await expect(task).toContainText('Astra · em andamento');

  const checkpoint = await openCheckpoint(page);
  await checkpoint.getByLabel('Resumo do progresso').fill('Contexto registrado e tarefa assumida.');
  await checkpoint.getByLabel('Próximo passo', { exact: true }).fill('Revisar a exportação antes de trocar de IA.');
  await checkpoint.getByLabel('Tarefa relacionada').selectOption({ label: 'Preparar o próximo agente' });
  await checkpoint.getByLabel('Decisões', { exact: true }).fill('Usar uma fonte compartilhada para o contexto.');
  await checkpoint.getByRole('button', { name: 'Salvar checkpoint', exact: true }).click();
  await expect(checkpoint).not.toBeVisible();
  await expect(page.locator('.checkpoint-card')).toContainText('Revisar a exportação antes de trocar de IA.');

  await page.getByRole('tab', { name: /^Mensagens/ }).click();
  await page.getByRole('button', { name: 'Nova mensagem', exact: true }).click();
  const message = page.getByRole('dialog', { name: 'Nova mensagem', exact: true });
  await message.getByLabel('Destinatário').fill('Grok');
  await message.getByLabel('Mensagem', { exact: true }).fill('Leia o próximo passo e mantenha as decisões registradas.');
  await message.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await expect(message).not.toBeVisible();
  await expect(page.locator('.message-card')).toContainText('Leia o próximo passo');

  await page.getByRole('button', { name: 'Exportar contexto', exact: true }).click();
  const exported = page.getByRole('dialog', { name: 'Exportar contexto', exact: true });
  const content = exported.getByLabel('Contexto para compartilhar');
  await expect(content).toHaveValue(/Revisar a exportação antes de trocar de IA/);
  await expect(content).toHaveValue(/Usar uma fonte compartilhada/);
  const bundleDownload = page.waitForEvent('download');
  await exported.getByRole('button', { name: 'Baixar pacote AXON', exact: true }).click();
  expect((await bundleDownload).suggestedFilename()).toBe('axon-project.json');
  const downloading = page.waitForEvent('download');
  await exported.getByRole('button', { name: 'Baixar Markdown', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('axon-contexto.md');
  expect(await download.failure()).toBeNull();
  await page.keyboard.press('Escape');
  await expect(exported).not.toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.locator('.resume-card')).toContainText('Revisar a exportação antes de trocar de IA.');
  await expect(page.locator('article.task')).toContainText('Astra · em andamento');
  await page.screenshot({ path: info.outputPath('workspace-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('conflito entre duas sessões preserva o rascunho e os dois checkpoints', async ({ page, context }) => {
  const url = await newProject(page, 'Projeto com duas sessões');
  const second = await context.newPage();
  await second.goto(url);
  const stale = await openCheckpoint(second);
  await stale.getByLabel('Resumo do progresso').fill('Rascunho da segunda sessão.');
  await stale.getByLabel('Próximo passo', { exact: true }).fill('Continuar após conciliar a revisão.');

  const first = await openCheckpoint(page);
  await first.getByLabel('Resumo do progresso').fill('Primeira sessão salvou.');
  await first.getByLabel('Próximo passo', { exact: true }).fill('Revisar o trabalho conjunto.');
  await first.getByRole('button', { name: 'Salvar checkpoint', exact: true }).click();
  await expect(first).not.toBeVisible();

  await stale.getByRole('button', { name: 'Salvar checkpoint', exact: true }).click();
  await expect(stale.getByRole('alert')).toBeVisible();
  await expect(stale.getByLabel('Resumo do progresso')).toHaveValue('Rascunho da segunda sessão.');
  await stale.getByRole('button', { name: 'Carregar versão atual', exact: true }).click();
  await expect(stale.getByRole('status')).toContainText('Versão 1 carregada');
  await expect(stale.getByLabel('Próximo passo', { exact: true })).toHaveValue('Continuar após conciliar a revisão.');
  await stale.getByRole('button', { name: 'Salvar checkpoint', exact: true }).click();
  await expect(stale).not.toBeVisible();
  await expect(second.locator('.checkpoint-card')).toHaveCount(2);
  await expect(second.locator('.checkpoint-card').first()).toContainText('Rascunho da segunda sessão.');
  await expect(second.locator('.checkpoint-card').last()).toContainText('Primeira sessão salvou.');
  await second.close();
});

test('erro de gravação mantém o formulário preenchido para tentar novamente', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
  await dialog.getByLabel('Nome do projeto').fill('Rascunho preservado');
  await dialog.getByLabel('Objetivo', { exact: true }).fill('Recuperar uma falha temporária.');
  await page.route('**/api/projects', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'temporary', message: 'Serviço temporariamente indisponível.' } }) });
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Serviço temporariamente indisponível');
  await expect(dialog.getByLabel('Nome do projeto')).toHaveValue('Rascunho preservado');
  await expect(dialog.getByLabel('Objetivo', { exact: true })).toHaveValue('Recuperar uma falha temporária.');
  await page.unroute('**/api/projects');
  await dialog.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rascunho preservado', exact: true })).toBeVisible();
});

test('mobile: navegar, criar e abrir diálogo sem ultrapassar a tela', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newProject(page, 'Workspace no celular');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('workspace-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  await expect(page.getByLabel('Nome do agente')).toBeVisible();
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Conexões', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conexões', exact: true })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('atalhos e movimento reduzido mantêm navegação e foco funcionais', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const name = 'Projeto pelo teclado';
  await newProject(page, name);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Ir para...', exact: true });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox').fill('Conexões');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Conexões', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await palette.getByRole('combobox').fill(name);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Buscar projetos e ações', exact: true });
  await trigger.click();
  await expect(palette.getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const font = await page.locator('body').evaluate(node => getComputedStyle(node).fontFamily);
  expect(font).not.toMatch(/Georgia|Instrument Serif|Times New Roman/i);
});


test('importa bundle pela biblioteca e confirma nova copia', async ({ page, request }, info) => {
  const created = await request.post('/api/projects', { headers: { 'X-Workspace-Client': 'local' }, data: { name: 'Fonte portátil', objective: 'Levar contexto entre instalações.' } });
  const project = await created.json();
  const bundleResponse = await request.get('/api/projects/' + project.id + '/bundle');
  const bundle = await bundleResponse.json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Importar projeto', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Importar projeto', exact: true });
  await modal.getByLabel('Pacote JSON').fill(JSON.stringify(bundle));
  await modal.getByRole('button', { name: 'Importar cópia', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fonte portátil', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('imported-project.png'), fullPage: true });
});

test('caixa de entrada por agente permite reconhecer mensagem', async ({ page, request }, info) => {
  await newProject(page, 'Caixa postal real');
  const projectId = page.url().split('/').pop()!;
  await request.post('/api/projects/' + projectId + '/messages', {
    headers: { 'X-Workspace-Client': 'local' },
    data: { from: 'Gemini', to: 'Astra', kind: 'review', body: 'Revise a integração de continuidade.' }
  });
  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByRole('tab', { name: /^Mensagens/ }).click();
  const inbox = page.getByRole('region', { name: 'Caixa de entrada de Astra' });
  await expect(inbox).toContainText('Revise a integração de continuidade.');
  await inbox.getByRole('button', { name: 'Marcar como lida', exact: true }).click();
  await expect(inbox).toContainText('Lida');
  await page.screenshot({ path: info.outputPath('agent-inbox.png'), fullPage: true });
});

test('ler uma pergunta não encerra a pendência; resolver com registro encerra', async ({ page, request }, info) => {
  await newProject(page, 'Pergunta com desfecho');
  const projectId = page.url().split('/').pop()!;
  await request.post('/api/projects/' + projectId + '/messages', {
    headers: { 'X-Workspace-Client': 'local' },
    data: { from: 'Gemini', to: 'Astra', kind: 'question', body: 'Qual contrato foi escolhido para a importação?' },
  });

  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByRole('tab', { name: /^Mensagens/ }).click();
  const inbox = page.getByRole('region', { name: 'Caixa de entrada de Astra' });
  const question = inbox.locator('article').filter({ hasText: 'Qual contrato foi escolhido para a importação?' });
  await question.getByRole('button', { name: 'Marcar como lida', exact: true }).click();
  await expect(question).toContainText('Lida');
  await expect(question.getByRole('button', { name: 'Resolver', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Retomar', exact: true }).click();
  const resume = page.getByRole('region', { name: 'Retomada inteligente de Astra' });
  await expect(resume).toContainText('1 item pede atenção');
  await expect(resume).toContainText('Qual contrato foi escolhido para a importação?');

  await page.getByRole('tab', { name: /^Mensagens/ }).click();
  const refreshedQuestion = page.getByRole('region', { name: 'Caixa de entrada de Astra' })
    .locator('article').filter({ hasText: 'Qual contrato foi escolhido para a importação?' });
  await refreshedQuestion.getByRole('button', { name: 'Resolver', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Resolver pendência', exact: true });
  await dialog.getByLabel('Como esta pendência foi resolvida?').fill('Adotamos o pacote AXON v2 e registramos a decisão no contrato.');
  await dialog.getByRole('button', { name: 'Registrar resolução', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(refreshedQuestion).toContainText('Resolvida');
  await expect(refreshedQuestion).toContainText('Adotamos o pacote AXON v2');

  await page.getByRole('tab', { name: 'Retomar', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Retomada inteligente de Astra' })).toContainText('0 itens pedem atenção');
  await page.screenshot({ path: info.outputPath('message-resolution.png'), fullPage: true });
});


test('rascunho de emergência aparece como não entregue e pode ser descartado', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await newProject(page, 'Sessão interrompida');
  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rascunho não entregue', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('não incrementa a versão');
  await dialog.getByLabel('O que estava sendo feito').fill('A sessão caiu no meio de store.ts.');
  await dialog.getByLabel('Próxima ação concreta').fill('Reabrir o teste RED e continuar a implementação.');
  await dialog.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const card = page.getByRole('region', { name: 'Rascunho não entregue' });
  await expect(card).toContainText(/Rascunho não entregue/i);
  await expect(card).toContainText('Este rascunho não substitui um checkpoint.');
  await expect(card).toContainText('A sessão caiu no meio de store.ts.');
  await expect(card).toContainText('Reabrir o teste RED e continuar a implementação.');
  await page.getByRole('tab', { name: 'Retomar', exact: true }).click();
  const resume = page.getByRole('region', { name: 'Retomada inteligente de Astra' });
  await expect(resume).toContainText(/Rascunho não entregue/i);
  await expect(resume).toContainText('Este rascunho não é um checkpoint.');
  await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
  await page.getByRole('button', { name: 'Descartar rascunho', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Rascunho não entregue' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('work-draft.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('tarefa concluída não pode ser assumida até ser reaberta', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await newProject(page, 'Fatia concluída');
  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByLabel('Título da tarefa').fill('Fechar a fatia');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  const task = page.locator('article.task').filter({ hasText: 'Fechar a fatia' });
  await task.getByRole('button', { name: 'Assumir tarefa', exact: true }).click();
  await page.getByRole('button', { name: 'Encerrar trabalho', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Encerrar trabalho', exact: true });
  await dialog.getByLabel('Resumo do progresso').fill('A fatia foi encerrada segundo o agente.');
  await dialog.getByLabel('Próximo passo').fill('Reabrir só se a revisão pedir.');
  await dialog.getByLabel('Tarefa relacionada').selectOption({ label: 'Fechar a fatia' });
  await dialog.getByLabel('O que acontece com a tarefa').selectOption('done');
  await dialog.getByRole('button', { name: 'Encerrar trabalho', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(task).toContainText('Concluída');
  await task.getByRole('button', { name: 'Reabrir tarefa', exact: true }).click();
  const reopen = page.getByRole('dialog', { name: 'Reabrir tarefa', exact: true });
  await reopen.getByLabel('Por que esta tarefa volta ao trabalho?').fill('A revisão pediu um ajuste no contrato.');
  await reopen.getByRole('button', { name: 'Reabrir tarefa', exact: true }).click();
  await expect(reopen).not.toBeVisible();
  await expect(task).toContainText('Disponível para assumir');
  await page.screenshot({ path: info.outputPath('task-done-reopen.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('encerrar trabalho salva checkpoint, entrega passagem e libera a tarefa', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await newProject(page, 'Saída da sessão');
  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByLabel('Título da tarefa').fill('Fechar a frente');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  const task = page.locator('article.task').filter({ hasText: 'Fechar a frente' });
  await task.getByRole('button', { name: 'Assumir tarefa', exact: true }).click();
  await page.getByRole('button', { name: 'Encerrar trabalho', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Encerrar trabalho', exact: true });
  await expect(dialog).toContainText('Não inicia uma IA');
  await dialog.getByLabel('Resumo do progresso').fill('A sessão foi encerrada com o contrato da saída.');
  await dialog.getByLabel('Próximo passo').fill('A próxima IA lê a passagem.');
  await dialog.getByLabel('Tarefa relacionada').selectOption({ label: 'Fechar a frente' });
  await dialog.getByLabel('Destinatário da passagem').fill('Grok');
  await dialog.getByLabel('Mensagem para a próxima IA').fill('Comece pelo próximo passo.');
  await dialog.getByRole('button', { name: 'Encerrar trabalho', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('tab', { name: /^Checkpoints/ }).click();
  await expect(page.getByRole('article').filter({ hasText: 'A sessão foi encerrada com o contrato da saída.' })).toBeVisible();
  await expect(page.locator('article.task').filter({ hasText: 'Fechar a frente' })).toContainText('Disponível para assumir');
  await page.screenshot({ path: info.outputPath('finalize-work.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('conexões explicam o correio sem exibir controle de modelos', async ({ page }, info) => {
  await page.goto('/#connect');
  await expect(page.getByRole('heading', { name: 'Correio entre agentes', exact: true })).toBeVisible();
  await expect(page.getByText('Sem controle remoto', { exact: true })).toBeVisible();
  await expect(page.getByText('A Axon Works não controla modelos.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /iniciar grok|iniciar gemini|cancelar/i })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Ã(?:¡|©|£|µ|§|ª|³|º|¢)|Â(?:·| )|â(?:€|€¦|€™)|�/);
  await page.screenshot({ path: info.outputPath('mailbox-connections.png'), fullPage: true });
});



test('retomada inteligente reúne foco, próximo passo e correio do agente', async ({ page, request }, info) => {
  await newProject(page, 'Passagem inteligente');
  const projectId = page.url().split('/').pop()!;
  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByLabel('Título da tarefa').fill('Revisar continuidade');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  await page.getByLabel('Título da tarefa').fill('Preparar biblioteca');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  const task = page.locator('article.task').filter({ hasText: 'Revisar continuidade' });
  await task.getByRole('button', { name: 'Assumir tarefa', exact: true }).click();
  const checkpoint = await openCheckpoint(page);
  await checkpoint.getByLabel('Resumo do progresso').fill('Estrutura do correio concluída.');
  await checkpoint.getByLabel('Próximo passo', { exact: true }).fill('Conferir a passagem deixada pelo Grok.');
  await checkpoint.getByLabel('Tarefa relacionada').selectOption({ label: 'Revisar continuidade' });
  await checkpoint.getByRole('button', { name: 'Salvar checkpoint', exact: true }).click();
  await request.post('/api/projects/' + projectId + '/messages', {
    headers: { 'X-Workspace-Client': 'local' },
    data: { from: 'Grok', to: 'Astra', kind: 'review', body: 'Revise a seleção do briefing antes de continuar.' }
  });
  await page.getByRole('tab', { name: 'Retomar', exact: true }).click();
  const resume = page.getByRole('region', { name: 'Retomada inteligente de Astra' });
  const focus = resume.getByLabel('Tarefa em foco');
  await expect(focus).toHaveValue(/.+/);
  await expect(resume).toContainText('Revisar continuidade');
  await expect(resume).toContainText('Conferir a passagem deixada pelo Grok.');
  await expect(resume).toContainText('Revise a seleção do briefing antes de continuar.');
  await expect(resume).toContainText('1 item pede atenção');
  await focus.selectOption({ label: 'Preparar biblioteca' });
  await expect(resume.getByRole('heading', { name: 'Preparar biblioteca', exact: true })).toBeVisible();
  await expect(resume).toContainText('Nenhum checkpoint ligado a esta tarefa.');
  await expect(resume.getByText('Contexto geral do projeto', { exact: true })).toBeVisible();
  await focus.selectOption({ label: 'Visão geral do projeto' });
  await expect(focus).toHaveValue('');
  await expect(resume.getByText('VISÃO GERAL', { exact: true })).toBeVisible();
  await expect(resume.getByRole('heading', { name: 'Escolha a tarefa que será retomada', exact: true })).toBeVisible();
  await expect(resume).toContainText('Conferir a passagem deixada pelo Grok.');
  await expect(resume.getByRole('button', { name: 'Copiar briefing', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('smart-resume.png'), fullPage: true });
});

test('falha ao trocar o foco restaura a seleção e o briefing coerentes', async ({ page }) => {
  await newProject(page, 'Retomada sem mistura');
  const projectId = page.url().split('/').pop()!;
  await page.getByLabel('Título da tarefa').fill('Tarefa confirmada');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  await page.getByLabel('Título da tarefa').fill('Tarefa indisponível');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  await page.locator('article.task').filter({ hasText: 'Tarefa confirmada' }).getByRole('button', { name: 'Assumir tarefa', exact: true }).click();
  await page.getByRole('tab', { name: 'Retomar', exact: true }).click();

  const resume = page.getByRole('region', { name: 'Retomada inteligente de Astra' });
  const focus = resume.getByLabel('Tarefa em foco');
  await expect(resume.getByRole('heading', { name: 'Tarefa confirmada', exact: true })).toBeVisible();
  const confirmedTaskId = await focus.inputValue();

  await page.route('**/api/projects/' + projectId + '/resume?*', route => {
    if (new URL(route.request().url()).searchParams.has('taskId')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'temporary', message: 'Não foi possível trocar o foco agora.' } }) });
    }
    return route.continue();
  });
  await focus.selectOption({ label: 'Tarefa indisponível' });
  await expect(resume.getByRole('alert')).toContainText('Não foi possível trocar o foco agora.');
  await expect(focus).toHaveValue(confirmedTaskId);
  await expect(resume.getByRole('heading', { name: 'Tarefa confirmada', exact: true })).toBeVisible();
  await expect(resume.getByRole('heading', { name: 'Tarefa indisponível', exact: true })).toHaveCount(0);
});

test('passagem estruturada: entregar checkpoint, receber como outra IA e confirmar leitura', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await newProject(page, 'Passagem entre IAs');
  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByLabel('Título da tarefa').fill('Fechar o contrato de passagem');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  const task = page.locator('article.task').filter({ hasText: 'Fechar o contrato de passagem' });
  await task.getByRole('button', { name: 'Assumir tarefa', exact: true }).click();

  const checkpoint = await openCheckpoint(page);
  await checkpoint.getByLabel('Resumo do progresso').fill('Checkpoint pronto para a próxima IA.');
  await checkpoint.getByLabel('Próximo passo', { exact: true }).fill('Confirmar a leitura e seguir o contrato.');
  await checkpoint.getByLabel('Tarefa relacionada').selectOption({ label: 'Fechar o contrato de passagem' });
  await checkpoint.getByRole('button', { name: 'Salvar checkpoint', exact: true }).click();
  await expect(checkpoint).not.toBeVisible();

  const card = page.locator('.checkpoint-card').filter({ hasText: 'Checkpoint pronto para a próxima IA.' });
  await card.getByRole('button', { name: 'Entregar para outra IA', exact: true }).click();
  const deliver = page.getByRole('dialog', { name: 'Entregar para outra IA', exact: true });
  await expect(deliver).toBeVisible();
  await expect(deliver).toContainText('A mensagem acompanha o checkpoint');
  await expect(deliver).toContainText('Checkpoint pronto para a próxima IA.');
  await expect(deliver).toContainText('Confirmar a leitura e seguir o contrato.');
  await expect(deliver).toContainText('Fechar o contrato de passagem');
  await deliver.getByLabel('Destinatário').fill('Grok');
  await deliver.getByLabel('Mensagem para a próxima IA').fill('Comece pela revisão do contrato e confirme que leu.');
  await deliver.getByRole('button', { name: 'Entregar passagem', exact: true }).click();
  await expect(deliver).not.toBeVisible();

  await page.getByLabel('Nome do agente').fill('Grok');
  await expect(page.getByRole('tab', { name: 'Mensagens 1', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^Mensagens/ }).click();
  const deliveries = page.getByRole('region', { name: 'Passagens de trabalho de Grok' });
  await expect(deliveries).toContainText('Comece pela revisão do contrato e confirme que leu.');
  await expect(deliveries).toContainText('Astra');
  await expect(deliveries).toContainText('Grok');
  await expect(deliveries).toContainText('Checkpoint pronto para a próxima IA.');
  await expect(deliveries).toContainText('Confirmar a leitura e seguir o contrato.');
  await expect(deliveries).toContainText('Não lida');

  await page.getByRole('tab', { name: 'Retomar', exact: true }).click();
  const resume = page.getByRole('region', { name: 'Retomada inteligente de Grok' });
  await expect(resume).toContainText('Comece pela revisão do contrato e confirme que leu.');
  await resume.getByRole('button', { name: 'Confirmar leitura', exact: true }).click();
  await expect(resume).toContainText('Lida');
  await expect(page.getByRole('tab', { name: 'Mensagens 0', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /^Mensagens/ }).click();
  await expect(page.getByRole('region', { name: 'Passagens de trabalho de Grok' })).toContainText('Lida');
  await page.screenshot({ path: info.outputPath('structured-handoff.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('backlog: capturar ideia, preparar, promover e ver a tarefa na lista', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await newProject(page, 'Backlog do projeto');
  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByRole('tab', { name: /^Backlog/ }).click();
  await expect(page.getByRole('heading', { name: 'Backlog', exact: true })).toBeVisible();
  await expect(page.getByText('Capture a ideia antes de virar tarefa.')).toBeVisible();
  await page.getByLabel('Título da ideia').fill('Revisar mascaramento de segredos');
  await page.getByRole('button', { name: 'Capturar ideia', exact: true }).click();
  const ideas = page.getByRole('region', { name: 'Ideias em avaliação' });
  await expect(ideas).toContainText('Revisar mascaramento de segredos');
  await ideas.getByRole('button', { name: 'Preparar ideia', exact: true }).click();
  const ready = page.getByRole('region', { name: 'Prontos para virar tarefa' });
  await expect(ready).toContainText('Revisar mascaramento de segredos');
  await ready.getByRole('button', { name: 'Transformar em tarefa', exact: true }).click();
  await expect(page.locator('article.task')).toContainText('Revisar mascaramento de segredos');
  await expect(ready).not.toContainText('Revisar mascaramento de segredos');
  await expect(page.getByRole('tab', { name: 'Backlog 0', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('backlog-promote.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('exclusão segura: arquiva ideia antes de apagar e exige nome exato do projeto', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const name = 'Projeto descartável com confirmação';
  await newProject(page, name);

  await page.getByRole('tab', { name: /^Backlog/ }).click();
  await page.getByLabel('Título da ideia').fill('Rascunho que pode ser removido');
  await page.getByRole('button', { name: 'Capturar ideia', exact: true }).click();
  const ideas = page.getByRole('region', { name: 'Ideias em avaliação' });
  await ideas.getByRole('button', { name: 'Arquivar Rascunho que pode ser removido' }).click();
  await expect(ideas).not.toContainText('Rascunho que pode ser removido');

  await page.getByRole('button', { name: 'Mostrar arquivadas', exact: true }).click();
  const archived = page.getByRole('region', { name: 'Ideias arquivadas' });
  await expect(archived).toContainText('Rascunho que pode ser removido');
  await archived.getByRole('button', { name: 'Excluir permanentemente', exact: true }).click();
  const deleteIdea = page.getByRole('dialog', { name: 'Excluir ideia arquivada', exact: true });
  await expect(deleteIdea).toContainText('Tarefas, checkpoints e mensagens permanecem.');
  await deleteIdea.getByRole('button', { name: 'Excluir permanentemente', exact: true }).click();
  await expect(deleteIdea).not.toBeVisible();
  await expect(archived).not.toContainText('Rascunho que pode ser removido');

  await page.getByRole('button', { name: 'Excluir projeto', exact: true }).click();
  const deleteProject = page.getByRole('dialog', { name: 'Excluir projeto', exact: true });
  const confirmButton = deleteProject.getByRole('button', { name: 'Excluir projeto', exact: true });
  await expect(confirmButton).toBeDisabled();
  await deleteProject.getByLabel('Digite o nome do projeto').fill('Projeto descartável');
  await expect(confirmButton).toBeDisabled();
  await deleteProject.getByLabel('Digite o nome do projeto').fill(name);
  await expect(confirmButton).toBeEnabled();
  await page.screenshot({ path: info.outputPath('delete-project-confirmation.png'), fullPage: true });
  await confirmButton.click();
  await expect(deleteProject).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projetos', exact: false })).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('guia para IAs apresenta o protocolo de entrada e passagem', async ({ page }) => {
  await page.goto('/#guide');
  await expect(page.getByRole('heading', { name: 'Guia para IAs', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Leia antes de agir. Registre antes de sair.', exact: true })).toBeVisible();
  await expect(page.getByText('Entre pelo briefing de retomada.', { exact: true })).toBeVisible();
  await expect(page.getByText('Entregue o bastão à próxima IA.', { exact: true })).toBeVisible();
  await expect(page.getByText('AI-GUIDE.md', { exact: true })).toBeVisible();
});

test('exporta e importa pacote v2 preservando backlog e passagem', async ({ page, request }, info) => {
  await newProject(page, 'Origem do pacote v2');
  const projectId = page.url().split('/').pop()!;
  await page.getByLabel('Nome do agente').fill('Astra');
  await request.post('/api/projects/' + projectId + '/backlog', {
    headers: { 'X-Workspace-Client': 'local' },
    data: { title: 'Ideia via pacote', createdBy: 'Astra', priority: 'high' },
  });
  await page.getByLabel('Título da tarefa').fill('Tarefa da passagem');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  const task = page.locator('article.task').filter({ hasText: 'Tarefa da passagem' });
  await task.getByRole('button', { name: 'Assumir tarefa', exact: true }).click();
  const checkpoint = await openCheckpoint(page);
  await checkpoint.getByLabel('Resumo do progresso').fill('Origem pronta para exportar.');
  await checkpoint.getByLabel('Próximo passo', { exact: true }).fill('Importar e conferir a passagem.');
  await checkpoint.getByRole('button', { name: 'Salvar checkpoint', exact: true }).click();
  const card = page.locator('.checkpoint-card').filter({ hasText: 'Origem pronta para exportar.' });
  await card.getByRole('button', { name: 'Entregar para outra IA', exact: true }).click();
  const deliver = page.getByRole('dialog', { name: 'Entregar para outra IA', exact: true });
  await deliver.getByLabel('Destinatário').fill('Grok');
  await deliver.getByLabel('Mensagem para a próxima IA').fill('Confira o backlog importado.');
  await deliver.getByRole('button', { name: 'Entregar passagem', exact: true }).click();
  await expect(deliver).not.toBeVisible();

  const bundleResponse = await request.get('/api/projects/' + projectId + '/bundle?version=2');
  const bundle = await bundleResponse.json();
  expect(bundle.version).toBe(2);
  expect(bundle.backlogItems.some((item: { title: string }) => item.title === 'Ideia via pacote')).toBe(true);
  expect(bundle.deliveries.length).toBeGreaterThan(0);

  await page.goto('/');
  await page.getByRole('button', { name: 'Importar projeto', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Importar projeto', exact: true });
  await modal.getByLabel('Pacote JSON').fill(JSON.stringify(bundle));
  await modal.getByRole('button', { name: 'Importar cópia', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Origem do pacote v2', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^Backlog/ }).click();
  await expect(page.getByRole('region', { name: 'Ideias em avaliação' })).toContainText('Ideia via pacote');
  await page.getByLabel('Nome do agente').fill('Grok');
  await page.getByRole('tab', { name: /^Mensagens/ }).click();
  await expect(page.getByRole('region', { name: 'Passagens de trabalho de Grok' })).toContainText('Confira o backlog importado.');
  await page.screenshot({ path: info.outputPath('bundle-v2-import.png'), fullPage: true });
});

test('contrato de tarefa: prioridade, critérios de aceite, dependência bloqueante e saídas', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await newProject(page, 'Contrato e dependências');
  await page.getByLabel('Nome do agente').fill('Astra');

  // Adiciona tarefa base
  await page.getByLabel('Título da tarefa').fill('Preparar infraestrutura base');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  const taskBase = page.locator('article.task').filter({ has: page.getByRole('heading', { name: 'Preparar infraestrutura base', exact: true }) });
  await expect(taskBase).toBeVisible();

  // Adiciona tarefa dependente
  await page.getByLabel('Título da tarefa').fill('Implementar funcionalidade com dependência');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  const taskDep = page.locator('article.task').filter({ has: page.getByRole('heading', { name: 'Implementar funcionalidade com dependência', exact: true }) });
  await expect(taskDep).toBeVisible();

  // Abre diálogo de contrato da tarefa dependente
  await taskDep.getByRole('button', { name: 'Detalhes', exact: true }).click();
  const contractDialog = page.getByRole('dialog', { name: 'Detalhes da tarefa', exact: true });
  await expect(contractDialog).toBeVisible();

  // Configura prioridade urgente
  await contractDialog.getByLabel('Prioridade').selectOption('urgent');
  // Descrição
  await contractDialog.getByLabel('Descrição e especificação').fill('Exige que a infraestrutura esteja finalizada.');

  // Adiciona critério de aceite
  await contractDialog.getByRole('button', { name: 'Critério', exact: true }).click();
  const criterionInput = contractDialog.locator('.criterion-input').first();
  await criterionInput.fill('Banco de dados inicializado e migrado');

  // Vincula dependência
  const depCard = contractDialog.locator('.contract-dep-card').filter({ hasText: 'Preparar infraestrutura base' });
  await depCard.click();
  await expect(depCard).toHaveClass(/selected/);

  // Adiciona saída esperada
  await contractDialog.getByRole('button', { name: 'Saída', exact: true }).click();
  await contractDialog.locator('.output-title-input').first().fill('Schema migrado');
  await contractDialog.locator('.output-locator-input').first().fill('prisma/schema.prisma');

  // Salva contrato
  await contractDialog.getByRole('button', { name: 'Salvar detalhes', exact: true }).click();
  await expect(contractDialog).not.toBeVisible();

  // Valida reflexo no card da tarefa
  await expect(taskDep.locator('.task-priority-badge')).toContainText('Urgente');
  await expect(taskDep).toContainText('Exige que a infraestrutura esteja finalizada.');
  await expect(taskDep.locator('.task-dep-alert')).toContainText('Bloqueada por: Preparar infraestrutura base');
  await expect(taskDep).toContainText('Critérios (0/1)');
  await expect(taskDep).toContainText('Banco de dados inicializado e migrado');
  await expect(taskDep).toContainText('Schema migrado');

  // O botão de assumir fica desativado enquanto a dependência não está concluída
  const claimButton = taskDep.getByRole('button', { name: 'Dependência pendente', exact: true });
  await expect(claimButton).toBeVisible();
  await expect(claimButton).toBeDisabled();

  // Alterna o critério diretamente no card
  const criterionChip = taskDep.getByRole('button', { name: /Banco de dados inicializado/ });
  await criterionChip.click();
  await expect(taskDep).toContainText('Critérios (1/1)');

  // Agora assume a tarefa base e conclui via encerramento de trabalho
  await taskBase.getByRole('button', { name: 'Assumir tarefa', exact: true }).click();
  await page.getByRole('button', { name: 'Encerrar trabalho', exact: true }).click();
  const finishDialog = page.getByRole('dialog', { name: 'Encerrar trabalho', exact: true });
  await finishDialog.getByLabel('Resumo do progresso').fill('Infraestrutura provisionada com sucesso.');
  await finishDialog.getByLabel('Próximo passo').fill('Continuar com a funcionalidade dependente.');
  await finishDialog.getByLabel('Tarefa relacionada').selectOption({ label: 'Preparar infraestrutura base' });
  await finishDialog.getByLabel('O que acontece com a tarefa').selectOption('done');
  await finishDialog.getByRole('button', { name: 'Encerrar trabalho', exact: true }).click();
  await expect(finishDialog).not.toBeVisible();

  // Tarefa base concluída -> dependência foi satisfeita!
  await expect(taskBase).toContainText('Concluída');
  await expect(taskDep.locator('.task-dep-alert')).toHaveCount(0);

  // Agora a tarefa dependente pode ser assumida normalmente
  const unblockedClaim = taskDep.getByRole('button', { name: 'Assumir tarefa', exact: true });
  await expect(unblockedClaim).toBeEnabled();
  await unblockedClaim.click();
  await expect(taskDep).toContainText('Astra · em andamento');

  await page.screenshot({ path: info.outputPath('task-contract-complete.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('conector de agentes gera snippets MCP e protocolo AGENTS.md para IAs externas', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await newProject(page, 'Conexão Externa IA');

  // No cabeçalho do projeto, clica em "Conectar IA"
  await page.getByRole('button', { name: 'Conectar IA', exact: true }).click();
  const modal = page.getByRole('dialog', { name: /Conectar IA a "Conexão Externa IA"/i });
  await expect(modal).toBeVisible();

  // Aba Cursor está ativa por padrão, exibe .cursor/mcp.json e .cursorrules
  await expect(modal.getByText('.cursor/mcp.json')).toBeVisible();
  await expect(modal.getByText('.cursorrules', { exact: true })).toBeVisible();

  // Alterna para Claude Code
  await modal.getByRole('tab', { name: /Claude Code/i }).click();
  await expect(modal.getByText('claude mcp add axon')).toBeVisible();
  await expect(modal.getByText('claude_desktop_config.json')).toBeVisible();

  // Alterna para Antigravity / Agy
  await modal.getByRole('tab', { name: /Antigravity \/ Agy/i }).click();
  await expect(modal.getByText('.gemini/settings.json')).toBeVisible();

  // Alterna para VS Code / Cline
  await modal.getByRole('tab', { name: /VS Code \/ Cline/i }).click();
  await expect(modal.getByText('.vscode/mcp.json')).toBeVisible();

  // Alterna para AGENTS.md
  await modal.getByRole('tab', { name: /AGENTS.md/i }).click();
  await expect(modal.getByText('Protocolo de Continuidade — Axon Works')).toBeVisible();
  await expect(modal.getByRole('button', { name: /Baixar AGENTS.md/i })).toBeVisible();
  await expect(modal.getByRole('button', { name: /Copiar Markdown/i })).toBeVisible();

  // Fecha o modal
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(modal).not.toBeVisible();

  // Navega até a página global #connect
  await page.goto('/#connect');
  await expect(page.getByRole('heading', { name: 'Correio entre agentes', exact: true })).toBeVisible();
  await expect(page.getByText('Sem controle remoto', { exact: true })).toBeVisible();

  // Abre gerador global a partir de Conexões
  await page.getByRole('button', { name: /Gerador de Conectores & Protocolo/i }).click();
  const globalModal = page.getByRole('dialog', { name: 'Conectar agentes de IA' });
  await expect(globalModal).toBeVisible();
  await globalModal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(globalModal).not.toBeVisible();

  await page.screenshot({ path: info.outputPath('connectors-generator.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('grafo & inteligência: topologia, inspeção de nós, análise de impacto e changelog operacional', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Cria um novo projeto
  await newProject(page, 'Rede Neural de Continuidade');

  // Adiciona uma tarefa
  await page.getByLabel('Título da tarefa').fill('Estruturar modelo semântico');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  await expect(page.locator('article.task').filter({ hasText: 'Estruturar modelo semântico' })).toBeVisible();

  // Adiciona um checkpoint
  const checkpoint = await openCheckpoint(page);
  await checkpoint.getByLabel('Resumo do progresso').fill('Base de arquitetura mapeada.');
  await checkpoint.getByLabel('Próximo passo', { exact: true }).fill('Executar auditoria topológica.');
  await checkpoint.getByRole('button', { name: 'Salvar checkpoint', exact: true }).click();
  await expect(checkpoint).not.toBeVisible();

  // Retorna para a Visão Geral para verificar o painel operacional
  await page.getByRole('tab', { name: 'Visão geral' }).click();

  // Verifica que o painel "O que mudou desde a última vez" é renderizado na Visão Geral
  await expect(page.getByRole('region', { name: 'O que mudou desde a última vez' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'O que mudou desde a última vez' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Copiar Mudanças/i })).toBeVisible();

  // Navega para a aba Grafo & Inteligência
  await page.getByRole('tab', { name: /Relações/i }).click();

  // Verifica cabeçalho e KPIs
  await expect(page.getByRole('heading', { name: 'Grafo de Linhagem, Decisões & Dependências' })).toBeVisible();
  await expect(page.getByText('Total de Nós')).toBeVisible();
  await expect(page.getByText('Relações Ativas')).toBeVisible();
  await expect(page.getByText('Conflitos de Decisão')).toBeVisible();
  await expect(page.getByText('Conteúdos Desatualizados')).toBeVisible();

  // Verifica que os swimlanes estão visíveis
  await expect(page.getByRole('heading', { name: 'Tarefas & Detalhes' })).toBeVisible();
  await expect(page.locator('.graph-lanes-grid').getByText('Estruturar modelo semântico')).toBeVisible();

  // Clica no nó da tarefa para inspecionar e disparar análise de impacto
  await page.locator('.graph-node-card').filter({ hasText: 'Estruturar modelo semântico' }).click();

  // Verifica o inspetor lateral com análise de impacto
  const sidebar = page.locator('.graph-inspector-sidebar');
  await expect(sidebar.getByRole('heading', { name: 'Estruturar modelo semântico' })).toBeVisible();
  await expect(sidebar.getByText('Análise de Alcance e Impacto')).toBeVisible();
  await expect(sidebar.getByText(/Risco Baixo|Risco Atenção|Risco Crítico/i)).toBeVisible();

  // Alterna para subview "Inteligência de Conflitos"
  await page.locator('.graph-subnav-btn', { hasText: 'Inteligência de Conflitos' }).click();
  await expect(page.getByRole('heading', { name: 'Diagnósticos de Conflito em Decisões' })).toBeVisible();
  await expect(page.getByText('Nenhum conflito encontrado!')).toBeVisible();

  // Alterna para subview "Frescor de Biblioteca"
  await page.locator('.graph-subnav-btn', { hasText: 'Frescor de Biblioteca' }).click();
  await expect(page.getByRole('heading', { name: 'Auditoria de Frescor de Conteúdo da Biblioteca' })).toBeVisible();
  await expect(page.getByText('Biblioteca 100% atualizada!')).toBeVisible();

  // Retorna para o Mapa Topológico
  await page.locator('.graph-subnav-btn', { hasText: 'Mapa Topológico' }).click();
  await expect(page.getByRole('heading', { name: 'Tarefas & Detalhes' })).toBeVisible();

  await page.screenshot({ path: info.outputPath('graph-intelligence-panel.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('evidencia honesta: tres afirmacoes separadas, frescor desatualizado em portugues, conferencia cruzada e linha do tempo', async ({ page, request }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  const tempWorkspace = mkdtempSync(path.join(tmpdir(), 'axon-ui-evidence-'));
  const relativeFile = 'src/service.ts';
  const fullFilePath = path.join(tempWorkspace, relativeFile);
  mkdirSync(path.dirname(fullFilePath), { recursive: true });
  writeFileSync(fullFilePath, 'export const version = 1;\n');
  const initialSha = createHash('sha256').update('export const version = 1;\n').digest('hex');

  try {
    await newProject(page, 'Honestidade e Evidencias Reais', tempWorkspace);
    const projectId = page.url().split('/').pop()!;
    await page.getByLabel('Nome do agente').fill('Astra');

    // 1. Grava checkpoint com evidencia apontando artefato real com hash real no backend
    const cpRes = await request.post(`/api/projects/${projectId}/checkpoints`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Client': 'local',
      },
      data: {
        expectedRevision: 0,
        idempotencyKey: 'cp-real-evidence-1',
        agent: 'Astra',
        summary: 'Implementação com evidência e artefato real em disco.',
        nextStep: 'Conferir se o frescor reflete o estado real do arquivo.',
        evidence: [
          {
            command: 'npm test',
            outcome: 'passed',
            details: 'Todos os testes de unidade passaram.',
            artifacts: [
              {
                path: relativeFile,
                sha256: initialSha,
              },
            ],
          },
        ],
      },
    });
    expect(cpRes.status()).toBe(201);

    // Carrega aba de Checkpoints na interface
    await page.reload();
    await page.getByRole('tab', { name: /^Checkpoints/ }).click();
    const card = page.locator('.checkpoint-card').first();
    await expect(card).toBeVisible();

    // As afirmações nunca se fundem num selo único
    await expect(card.getByText('Informado pela IA')).toBeVisible();
    await expect(card.getByText('Arquivos conferidos pelo sistema')).toBeVisible();
    await expect(card.getByText('Verificado', { exact: true })).toHaveCount(0);

    // Arquivo não mudou: frescor covers_current (não deve ter a classe .evidence-stale)
    await expect(card.locator('.evidence.evidence-stale')).toHaveCount(0);
    await expect(card.getByText(relativeFile, { exact: true })).toBeVisible();

    // 2. ALTERA o arquivo no disco de verdade para forçar a evidência a se tornar stale
    writeFileSync(fullFilePath, 'export const version = 2; // alterado apos teste\n');

    // Recarrega e valida que a interface agora exibe a evidência como desatualizada
    await page.reload();
    await page.getByRole('tab', { name: /^Checkpoints/ }).click();
    const staleCard = page.locator('.checkpoint-card').first();
    await expect(staleCard).toBeVisible();

    // Evidência desatualizada é visualmente distinta e explica o motivo em português
    await expect(staleCard.locator('.evidence.evidence-stale')).toBeVisible();
    await expect(staleCard.getByText(/Esta evidência não cobre/i).first()).toBeVisible();
    await expect(staleCard.getByText(/mudou.*desde a medição/i).first()).toBeVisible();

    // 3. Conferência cruzada como ação da interface contra o backend real
    await staleCard.getByRole('button', { name: 'Conferir evidência', exact: true }).click();
    const crossModal = page.getByRole('dialog', { name: 'Conferência cruzada de evidência', exact: true });
    await expect(crossModal).toBeVisible();
    await expect(crossModal.getByText(/Continua sendo relato/i)).toBeVisible();

    // Tenta auto-conferência (Astra relatou e Astra tenta conferir)
    await crossModal.getByLabel('Identidade de quem confere').fill('Astra');
    await crossModal.getByLabel('Nota da conferência').fill('Eu mesma conferi meu próprio teste.');
    await crossModal.getByRole('button', { name: 'Registrar conferência', exact: true }).click();

    // Backend real retorna 409 self_verification_rejected tratado com explicação amigável
    await expect(crossModal.getByRole('alert')).toContainText('A mesma identidade que relatou o teste não pode conferir a própria evidência.');

    // Confere com outra identidade (Grok)
    await crossModal.getByLabel('Identidade de quem confere').fill('Grok');
    await crossModal.getByLabel('Nota da conferência').fill('Conferi a execução independente e os arquivos bateram.');
    await crossModal.getByRole('button', { name: 'Registrar conferência', exact: true }).click();
    await expect(crossModal).not.toBeVisible();

    // Agora a conferência cruzada aparece separadamente
    await expect(staleCard.getByText(/Conferido por outra IA \(1\)/i)).toBeVisible();
    await expect(staleCard.getByText('Conferido por Grok')).toBeVisible();
    await expect(staleCard.getByText('Conferi a execução independente e os arquivos bateram.')).toBeVisible();

    // 4. Linha do tempo de Bloqueios com backend real
    await page.getByRole('tab', { name: 'Visão geral' }).click();
    await page.getByRole('button', { name: 'Abrir bloqueio', exact: true }).click();
    await page.getByLabel('Título do bloqueio').fill('Migração de dados');
    await page.getByLabel('O que impede o trabalho').fill('Tabelas bloqueadas.');
    await page.getByRole('button', { name: 'Salvar bloqueio', exact: true }).click();
    const blockerEntry = page.locator('.decision-entry').filter({ hasText: 'Migração de dados' });
    await expect(blockerEntry).toBeVisible();

    // Busca detalhes do bloqueio via backend
    const blkRes = await request.get(`/api/projects/${projectId}/blockers`);
    const blockers = await blkRes.json();
    const blocker = blockers.find((b: any) => b.title === 'Migração de dados');
    expect(blocker).toBeDefined();

    // Resolve o bloqueio via backend real com nota
    const resolveRes = await request.post(`/api/projects/${projectId}/blockers/${blocker.id}/resolve`, {
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' },
      data: { agent: 'Grok', expectedVersion: blocker.version, note: 'Migração aplicada com sucesso no store' }
    });
    expect(resolveRes.status()).toBe(200);
    const resolvedData = await resolveRes.json();

    // Reabre o bloqueio via backend real com nota
    const reopenRes = await request.post(`/api/projects/${projectId}/blockers/${blocker.id}/reopen`, {
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' },
      data: { agent: 'Astra', expectedVersion: resolvedData.version, note: 'Regressão encontrada na exclusão em cascata' }
    });
    expect(reopenRes.status()).toBe(200);

    // Recarrega a tela para ler o histórico atualizado
    await page.reload();
    await page.getByRole('tab', { name: 'Visão geral' }).click();
    const refreshedBlocker = page.locator('.decision-entry').filter({ hasText: 'Migração de dados' });
    await refreshedBlocker.getByRole('button', { name: 'Histórico', exact: true }).click();
    const blockerDialog = page.getByRole('dialog', { name: /Linha do tempo do bloqueio/i });
    await expect(blockerDialog).toBeVisible();
    await expect(blockerDialog.getByText('Aberto', { exact: true })).toBeVisible();
    await expect(blockerDialog.getByText('Migração aplicada com sucesso no store')).toBeVisible();
    await expect(blockerDialog.getByText('Regressão encontrada na exclusão em cascata')).toBeVisible();
    await blockerDialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(blockerDialog).not.toBeVisible();

    // 5. Linha do tempo de Decisões com backend real
    await page.getByRole('tab', { name: /^Decisões/ }).click();
    await page.getByRole('button', { name: 'Propor decisão', exact: true }).click();
    const decDialog = page.getByRole('dialog', { name: 'Propor decisão', exact: true });
    await decDialog.getByLabel('Título da decisão').fill('Estrutura canônica de persistência');
    await decDialog.getByLabel('Conteúdo e justificativa').fill('Usaremos SQLite em modo WAL.');
    await decDialog.getByRole('button', { name: 'Propor decisão', exact: true }).click();
    await expect(decDialog).not.toBeVisible();

    // Aceita a decisão via backend real
    const decListRes = await request.get(`/api/projects/${projectId}/decisions?includeHistory=true`);
    const decisions = await decListRes.json();
    const decision = decisions.find((d: any) => d.title === 'Estrutura canônica de persistência');
    expect(decision).toBeDefined();

    const acceptRes = await request.post(`/api/projects/${projectId}/decisions/${decision.id}/accept`, {
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' },
      data: { actor: 'Ana', expectedVersion: decision.version }
    });
    expect(acceptRes.status()).toBe(200);

    // Revoga a decisão para testar nota auditável na linha do tempo
    const revokeRes = await request.post(`/api/projects/${projectId}/decisions/${decision.id}/revoke`, {
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' },
      data: { actor: 'Ana', expectedVersion: decision.version + 1, note: 'Mudança de requisito de infraestrutura' }
    });
    expect(revokeRes.status()).toBe(200);

    // Recarrega e abre linha do tempo da decisão
    await page.reload();
    await page.getByRole('tab', { name: /^Decisões/ }).click();
    await page.getByRole('button', { name: 'Mostrar histórico completo', exact: true }).click();
    const decCard = page.locator('.decision-card').filter({ hasText: 'Estrutura canônica de persistência' });
    await expect(decCard).toBeVisible();
    await decCard.getByRole('button', { name: 'Linha do tempo', exact: true }).click();
    const timelineDialog = page.getByRole('dialog', { name: /Linha do tempo da decisão/i });
    await expect(timelineDialog).toBeVisible();
    await expect(timelineDialog.getByText('Proposta', { exact: true })).toBeVisible();
    await expect(timelineDialog.getByText('Mudança de requisito de infraestrutura')).toBeVisible();
    await timelineDialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(timelineDialog).not.toBeVisible();

    await page.screenshot({ path: info.outputPath('verifiable-evidence-journey.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true });
  }
});

// Regressão: a coluna de tarefas (.workspace-secondary) esticava junto com o
// conteúdo, sem rolagem própria, e a grade esticava a coluna principal
// (.workspace-primary) até a mesma altura — sobrando um vazio enorme embaixo
// do conteúdo principal.
test('coluna de tarefas rola sozinha e não estica a coluna principal', async ({ page }, info) => {
  const viewport = { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await newProject(page, 'Coluna com rolagem própria');
  await page.getByLabel('Nome do agente').fill('Astra');

  // Uma dúzia de tarefas é o suficiente para transbordar a coluna de 280px.
  for (let i = 1; i <= 12; i++) {
    await page.getByLabel('Título da tarefa').fill(`Tarefa ${i} — verificação de transbordo da coluna lateral de tarefas`);
    await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
    await expect(page.locator('article.task')).toHaveCount(i);
  }

  const secondary = page.locator('.workspace-secondary');
  const primary = page.locator('.workspace-primary');
  await expect(secondary).toBeVisible();
  await expect(primary).toBeVisible();

  const secondaryMetrics = await secondary.evaluate(el => ({
    rectHeight: el.getBoundingClientRect().height,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  const primaryHeight = await primary.evaluate(el => el.getBoundingClientRect().height);
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  const medidas = {
    viewportHeight: viewport.height,
    pageHeight,
    primaryHeight,
    workspaceSecondary: secondaryMetrics,
  };
  console.log('[coluna] medidas:', JSON.stringify(medidas));
  await info.attach('medidas-coluna.json', { body: JSON.stringify(medidas, null, 2), contentType: 'application/json' });

  // 1. A coluna de tarefas não é mais alta que a janela.
  expect(secondaryMetrics.rectHeight, 'altura renderizada da coluna de tarefas não pode passar da janela').toBeLessThanOrEqual(viewport.height);

  // 2. Ela tem rolagem própria: overflow-y auto/scroll e conteúdo maior que a área visível.
  expect(['auto', 'scroll'], 'overflow-y da coluna de tarefas precisa permitir rolagem própria').toContain(secondaryMetrics.overflowY);
  expect(secondaryMetrics.scrollHeight, 'conteúdo da coluna de tarefas precisa transbordar a área visível (scrollHeight > clientHeight)').toBeGreaterThan(secondaryMetrics.clientHeight);

  // 3. A coluna principal não herda a altura (de conteúdo) da coluna de tarefas.
  expect(primaryHeight, 'a coluna principal não pode ser esticada até a altura de conteúdo da coluna de tarefas').toBeLessThan(secondaryMetrics.scrollHeight - 300);

  expect(errors).toEqual([]);
});

test('aviso na barra lateral explica botoes desativados quando falta o nome da IA', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
  await modal.getByLabel('Nome do projeto').fill('Teste Aviso Botoes');
  await modal.getByLabel('Objetivo', { exact: true }).fill('Objetivo do teste.');
  await modal.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Teste Aviso Botoes', exact: true })).toBeVisible();

  // Sem nome de IA: botões desativados e aviso visível
  const agentInput = page.getByLabel('Nome do agente');
  await agentInput.fill('');
  await expect(page.locator('.agent-warning-hint')).toBeVisible();
  await expect(page.locator('.agent-warning-hint')).toContainText('Informe o nome na barra lateral');

  const draftBtn = page.getByRole('button', { name: 'Salvar rascunho', exact: true });
  const finishBtn = page.getByRole('button', { name: 'Encerrar trabalho', exact: true });
  await expect(draftBtn).toBeDisabled();
  await expect(finishBtn).toBeDisabled();

  // Com nome de IA preenchido: aviso some e botões ficam ativos
  await agentInput.fill('Astra');
  await expect(page.locator('.agent-warning-hint')).toHaveCount(0);
  await expect(draftBtn).toBeEnabled();
  await expect(finishBtn).toBeEnabled();
  expect(errors).toEqual([]);
});

test('cabecalho mostra apenas o primeiro paragrafo com conteudo de verdade e expande; abas visiveis sem rolar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
  await modal.getByLabel('Nome do projeto').fill('Projeto Diretriz Longa');
  await modal.getByLabel('Objetivo', { exact: true }).fill(
    '### OBJETIVO\nEste é o primeiro parágrafo com conteúdo de verdade da diretriz.\n\n### DIRETRIZES\nEste é o segundo parágrafo detalhado que não deve aparecer inicialmente no cabeçalho.'
  );
  await modal.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projeto Diretriz Longa', exact: true })).toBeVisible();

  // Cabeçalho mostra apenas o primeiro parágrafo
  const header = page.locator('.project-heading');
  await expect(header).toContainText('Este é o primeiro parágrafo com conteúdo de verdade da diretriz.');
  await expect(header).not.toContainText('Este é o segundo parágrafo detalhado');

  // As abas precisam estar visíveis na primeira tela (1440x900) sem rolagem
  const tabs = page.getByRole('tablist');
  await expect(tabs).toBeVisible();
  const tabsBox = await tabs.boundingBox();
  expect(tabsBox).not.toBeNull();
  expect(tabsBox!.y + tabsBox!.height, 'as abas precisam ficar visíveis nos primeiros 900px de altura sem rolagem').toBeLessThan(900);

  // Expande a diretriz completa
  const expandBtn = header.getByRole('button', { name: 'Ver diretriz completa' });
  await expect(expandBtn).toBeVisible();
  await expandBtn.click();
  await expect(header).toContainText('Este é o segundo parágrafo detalhado');
  await expect(header.getByRole('button', { name: 'Recolher diretriz' })).toBeVisible();

  // Recolhe a diretriz
  await header.getByRole('button', { name: 'Recolher diretriz' }).click();
  await expect(header).not.toContainText('Este é o segundo parágrafo detalhado');

  // Na biblioteca de projetos da tela inicial, a linha do projeto mostra o primeiro parágrafo sem prefixo "OBJETIVO"
  await page.goto('/');
  const projectCard = page.locator('.library-project').filter({ hasText: 'Projeto Diretriz Longa' });
  await expect(projectCard).toBeVisible();
  await expect(projectCard).toContainText('Este é o primeiro parágrafo com conteúdo de verdade');
  await expect(projectCard).not.toContainText('OBJETIVO Este é o primeiro');

  expect(errors).toEqual([]);
});

test('titulo Tarefas fica fixo no topo enquanto a lista de tarefas rola', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await newProject(page, 'Tarefas Sticky Header ' + Date.now());
  const projectId = page.url().split('#project/')[1];
  expect(projectId).toBeTruthy();
  const headers = { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' };

  for (let i = 1; i <= 15; i++) {
    const res = await request.post(`/api/projects/${projectId}/tasks`, {
      headers,
      data: { title: `Tarefa ${i} com texto descritivo para forçar rolagem lateral` }
    });
    expect(res.ok()).toBeTruthy();
  }

  await page.reload();
  const stickyHeader = page.locator('.tasks-header-sticky');
  await expect(stickyHeader).toBeVisible();
  await expect(stickyHeader.getByRole('heading', { name: 'Tarefas' })).toBeVisible();

  const initialBox = await stickyHeader.boundingBox();
  expect(initialBox).not.toBeNull();

  // Rola a coluna de tarefas para baixo
  const secondary = page.locator('.workspace-secondary');
  await secondary.evaluate(el => el.scrollTop = 500);

  // O cabeçalho sticky continua visível e dentro da tela
  await expect(stickyHeader).toBeVisible();
  const scrolledBox = await stickyHeader.boundingBox();
  expect(scrolledBox).not.toBeNull();
  expect(scrolledBox!.y).toBeGreaterThanOrEqual(0);
  expect(scrolledBox!.y).toBeLessThan(900);

  expect(errors).toEqual([]);
});

test('tarefas concluidas aparecem recolhidas com acao de reabrir visivel e detalhes expansiveis', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await newProject(page, 'Tarefa Concluida Recolhida ' + Date.now());

  // Cria tarefa
  await page.getByLabel('Título da tarefa').fill('Tarefa concluída com detalhes longos');
  await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
  const taskItem = page.locator('article.task').filter({ hasText: 'Tarefa concluída com detalhes longos' });
  await expect(taskItem).toBeVisible();

  // Adiciona detalhes à tarefa
  await taskItem.getByRole('button', { name: 'Detalhes', exact: true }).click();
  const detailsDialog = page.getByRole('dialog', { name: 'Detalhes da tarefa', exact: true });
  await detailsDialog.getByLabel('Descrição e especificação').fill('Especificação profunda que deve ficar recolhida quando concluída');
  await detailsDialog.getByRole('button', { name: 'Critério', exact: true }).click();
  await detailsDialog.locator('.criterion-input').first().fill('Critério Alpha verificado');
  await detailsDialog.getByRole('button', { name: 'Salvar detalhes', exact: true }).click();
  await expect(detailsDialog).not.toBeVisible();

  // Assume tarefa
  await taskItem.getByRole('button', { name: 'Assumir tarefa', exact: true }).click();

  // Encerra trabalho marcando como concluída
  await page.getByRole('button', { name: 'Encerrar trabalho', exact: true }).click();
  const finishDialog = page.getByRole('dialog', { name: 'Encerrar trabalho', exact: true });
  await finishDialog.getByLabel('Resumo do progresso').fill('Concluindo a tarefa com detalhes.');
  await finishDialog.getByLabel('Próximo passo').fill('Próximo passo após conclusão.');
  await finishDialog.getByLabel('Tarefa relacionada').selectOption({ label: 'Tarefa concluída com detalhes longos' });
  await finishDialog.getByLabel('O que acontece com a tarefa').selectOption('done');
  await finishDialog.getByRole('button', { name: 'Encerrar trabalho', exact: true }).click();
  await expect(finishDialog).not.toBeVisible();

  // Valida que agora aparece como concluída
  await expect(taskItem).toContainText('Concluída');

  // A ação de reabrir continua visível sem abrir nada
  const reopenBtn = taskItem.getByRole('button', { name: 'Reabrir tarefa', exact: true });
  await expect(reopenBtn).toBeVisible();

  // A especificação e critérios estão recolhidos
  await expect(taskItem.getByText('Especificação profunda que deve ficar recolhida')).toHaveCount(0);
  await expect(taskItem.getByText('Critério Alpha verificado')).toHaveCount(0);

  // O botão "Ver detalhes" permite expandir
  const toggleBtn = taskItem.getByRole('button', { name: 'Ver detalhes', exact: true });
  await expect(toggleBtn).toBeVisible();
  await toggleBtn.click();

  // Agora a especificação e critérios aparecem
  await expect(taskItem.getByText('Especificação profunda que deve ficar recolhida')).toBeVisible();
  await expect(taskItem.getByText('Critério Alpha verificado')).toBeVisible();
  await expect(taskItem.getByRole('button', { name: 'Recolher detalhes', exact: true })).toBeVisible();

  // Recolhe novamente
  await taskItem.getByRole('button', { name: 'Recolher detalhes', exact: true }).click();
  await expect(taskItem.getByText('Especificação profunda que deve ficar recolhida')).toHaveCount(0);
  await expect(taskItem.getByRole('button', { name: 'Ver detalhes', exact: true })).toBeVisible();

  // Reabrir funciona diretamente
  await reopenBtn.click();
  const reopenModal = page.getByRole('dialog', { name: 'Reabrir tarefa', exact: true });
  await expect(reopenModal).toBeVisible();
  await reopenModal.getByLabel('Por que esta tarefa volta ao trabalho?').fill('Necessidade de ajuste nos critérios');
  await reopenModal.getByRole('button', { name: 'Reabrir tarefa', exact: true }).click();
  await expect(reopenModal).not.toBeVisible();
  await expect(taskItem).toContainText('Disponível para assumir');

  expect(errors).toEqual([]);
});

test('contador das abas nunca mostra número inventado antes de o dado existir', async ({ page, request }) => {
  // Protege a promessa central do produto: a tela não afirma o que não verificou.
  // Antes da correção, a aba do grafo mostrava "0" com um conflito real no projeto.
  await newProject(page, 'Contador honesto ' + Date.now());
  const projectId = page.url().split('#project/')[1];
  expect(projectId).toBeTruthy();
  const headers = { 'Content-Type': 'application/json', 'X-Workspace-Client': 'local' };

  for (const [title, body] of [
    ['Arquitetura: usar Postgres para persistência relacional', 'Toda persistência relacional do projeto usará Postgres em produção.'],
    ['Arquitetura: usar Postgres para dados relacionais', 'Os dados relacionais do projeto ficam em Postgres gerenciado.'],
  ]) {
    const proposta = await request.post(`/api/projects/${projectId}/decisions`, { headers, data: { title, body, agent: 'Astra' } });
    expect(proposta.ok()).toBeTruthy();
    const decision = await proposta.json();
    const aceite = await request.post(`/api/projects/${projectId}/decisions/${decision.id}/accept`, { headers, data: { actor: 'Astra', expectedVersion: decision.version } });
    expect(aceite.ok()).toBeTruthy();
  }

  const conflicts = await (await request.get(`/api/projects/${projectId}/graph/conflicts`)).json();
  expect(conflicts.conflictCount).toBeGreaterThan(0);

  await page.reload();
  const graphTab = page.getByRole('tab', { name: /^Relações/ });
  await expect(graphTab).toBeVisible();
  expect((await graphTab.textContent())?.trim() ?? '').not.toMatch(/\d/);

  await graphTab.click();
  await expect.poll(async () => (await graphTab.textContent())?.trim() ?? '', { timeout: 5000 }).toMatch(/\d/);
  expect((await graphTab.textContent())?.trim() ?? '').toContain(String(conflicts.conflictCount));
});
