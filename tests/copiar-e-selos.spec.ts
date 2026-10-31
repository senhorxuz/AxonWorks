import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

test.describe('Parte 8 e Parte 6 — Copiar para outra IA e Selo de IA sumida', () => {
  test('botão de copiar desativado sem nome da IA, explicando o motivo no tom da aba Retomar', async ({ page, request }) => {
    // 1. Criar projeto real pela API
    const res = await request.post('/api/projects', {
      headers: { 'X-Workspace-Client': 'local' },
      data: { name: 'Projeto Sem IA Declarada', objective: 'Validar botão desativado na aba Retomar.' },
    });
    expect(res.ok()).toBeTruthy();
    const project = await res.json();

    // 2. Acessar tela do projeto
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

    // 3. Garantir que o nome do agente está vazio
    const agentInput = page.getByLabel('Nome do agente');
    await agentInput.fill('');

    // 4. Ir para a aba Retomar
    await page.getByRole('tab', { name: /^Retomar/ }).click();

    // 5. O botão "Copiar para outra IA" deve estar desativado
    const copyButton = page.getByRole('button', { name: /Copiar para outra IA/i });
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toBeDisabled();

    // 6. Deve explicar o motivo no mesmo tom da aba Retomar: "Informe o nome na barra lateral."
    await expect(page.locator('.copiar-para-outra-ia')).toContainText('Informe o nome na barra lateral.');
  });

  test('texto copiado e prévia contêm a instrução, a retomada da identidade e o pedido de frase simples para o dono', async ({ page, request, context }) => {
    // Conceder permissão de clipboard
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // 1. Criar projeto real pela API com dados reais
    const res = await request.post('/api/projects', {
      headers: { 'X-Workspace-Client': 'local' },
      data: { name: 'Projeto Continuidade Externa', objective: 'Levar contexto para IAs no navegador.' },
    });
    expect(res.ok()).toBeTruthy();
    const project = await res.json();

    // Adicionar uma tarefa ao projeto para enriquecer a retomada
    const taskRes = await request.post(`/api/projects/${project.id}/tasks`, {
      headers: { 'X-Workspace-Client': 'local' },
      data: { title: 'Implementar fluxo de exportação' },
    });
    expect(taskRes.ok()).toBeTruthy();

    // 2. Abrir o projeto na interface
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

    // 3. Declarar nome do agente na barra lateral
    const agentInput = page.getByLabel('Nome do agente');
    await agentInput.fill('Claude-Web');

    // 4. Ir para a aba Retomar
    await page.getByRole('tab', { name: /^Retomar/ }).click();

    // 5. Verificar a prévia do texto antes de copiar
    const previewTextarea = page.locator('#copiar-texto-previa');
    await expect(previewTextarea).toBeVisible();

    // A prévia deve conter:
    // (1) Instrução curta dizendo o que é Axon e que o conteúdo é dado, não ordem
    await expect(previewTextarea).toHaveValue(/correio de continuidade/i);
    await expect(previewTextarea).toHaveValue(/dado/i);
    await expect(previewTextarea).toHaveValue(/não.*ordem/i);

    // (2) A retomada daquela identidade (markdown do resume)
    await expect(previewTextarea).toHaveValue(/Projeto Continuidade Externa/i);

    // (3) Pedido de registro no formato do AI-GUIDE com frase simples para o dono
    await expect(previewTextarea).toHaveValue(/AGENTE:\s*Claude-Web/);
    await expect(previewTextarea).toHaveValue(/RESUMO DO QUE FOI FEITO:/);
    await expect(previewTextarea).toHaveValue(/FRASE SIMPLES PARA O DONO:/);
    await expect(previewTextarea).toHaveValue(/PRÓXIMO PASSO EXATO:/);

    // 6. Clicar no botão para copiar
    const copyButton = page.getByRole('button', { name: /Copiar para outra IA/i });
    await expect(copyButton).toBeEnabled();
    await copyButton.click();

    // 7. Sucesso no passado e específico: "Texto copiado. Cole na outra IA."
    await expect(page.locator('.copiar-para-outra-ia')).toContainText('Texto copiado. Cole na outra IA.');

    // 8. Validar conteúdo da área de transferência
    const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContent).toContain('correio de continuidade');
    expect(clipboardContent).toContain('Projeto Continuidade Externa');
    expect(clipboardContent).toContain('FRASE SIMPLES PARA O DONO:');
    expect(clipboardContent).toContain('AGENTE: Claude-Web');
  });

  test('honestidade na cópia: se a área de transferência falhar, explica o motivo e oferece seleção manual', async ({ page, request }) => {
    // 1. Criar projeto real pela API
    const res = await request.post('/api/projects', {
      headers: { 'X-Workspace-Client': 'local' },
      data: { name: 'Projeto Teste Clipboard Falha', objective: 'Testar honestidade quando clipboard rejeita.' },
    });
    expect(res.ok()).toBeTruthy();
    const project = await res.json();

    // 2. Abrir o projeto
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

    await page.getByLabel('Nome do agente').fill('Gemini-Manual');
    await page.getByRole('tab', { name: /^Retomar/ }).click();

    // 3. Simular falha na API de clipboard
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new Error('Clipboard access denied')),
        },
        configurable: true,
      });
    });

    // 4. Clicar em copiar
    const copyButton = page.getByRole('button', { name: /Copiar para outra IA/i });
    await expect(copyButton).toBeEnabled();
    await copyButton.click();

    // 5. NUNCA fingir que copiou: deve exibir mensagem de erro e orientar seleção manual
    await expect(page.locator('.copiar-para-outra-ia')).not.toContainText('Texto copiado. Cole na outra IA.');
    await expect(page.locator('.copiar-para-outra-ia')).toContainText('A área de transferência não está disponível. Selecione e copie o texto abaixo manualmente.');

    // A prévia do texto continua acessível para seleção manual
    const previewTextarea = page.locator('#copiar-texto-previa');
    await expect(previewTextarea).toBeVisible();
    await expect(previewTextarea).toHaveValue(/FRASE SIMPLES PARA O DONO:/);
  });

  test('selo de IA sumida aparece para tarefa realmente parada e NÃO aparece em tarefa ativa', async ({ page, request }) => {
    // 1. Criar projeto real pela API
    const pRes = await request.post('/api/projects', {
      headers: { 'X-Workspace-Client': 'local' },
      data: { name: 'Projeto Auditoria de IA Sumida', objective: 'Validar presença honesta do selo de IA sumida.' },
    });
    expect(pRes.ok()).toBeTruthy();
    const project = await pRes.json();

    // 2. Criar duas tarefas reais pela API
    const t1Res = await request.post(`/api/projects/${project.id}/tasks`, {
      headers: { 'X-Workspace-Client': 'local' },
      data: { title: 'Tarefa Ativa com Reserva Válida' },
    });
    const taskAtiva = await t1Res.json();

    const t2Res = await request.post(`/api/projects/${project.id}/tasks`, {
      headers: { 'X-Workspace-Client': 'local' },
      data: { title: 'Tarefa Parada por IA Sumida' },
    });
    const taskParada = await t2Res.json();

    // 3. Assumir as duas tarefas de verdade pela API
    const c1Res = await request.post(`/api/projects/${project.id}/tasks/${taskAtiva.id}/claim`, {
      headers: { 'X-Workspace-Client': 'local' },
      data: { agent: 'Astra', expectedVersion: taskAtiva.version },
    });
    expect(c1Res.ok()).toBeTruthy();

    const c2Res = await request.post(`/api/projects/${project.id}/tasks/${taskParada.id}/claim`, {
      headers: { 'X-Workspace-Client': 'local' },
      data: { agent: 'Grok', expectedVersion: taskParada.version },
    });
    expect(c2Res.ok()).toBeTruthy();

    // 4. Técnica do briefing: mover lease_until da tarefa parada para 2 horas atrás no banco real
    const dbPath = process.env.AXON_E2E_DB_PATH;
    expect(dbPath, 'AXON_E2E_DB_PATH deve estar definido').toBeTruthy();

    const db = new DatabaseSync(dbPath!);
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    db.prepare('UPDATE tasks SET lease_until = ? WHERE id = ?').run(twoHoursAgo, taskParada.id);
    db.close();

    // 5. Abrir projeto na tela
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

    // Localizar os cards das duas tarefas
    const cardAtiva = page.locator('article.task').filter({ hasText: 'Tarefa Ativa com Reserva Válida' });
    const cardParada = page.locator('article.task').filter({ hasText: 'Tarefa Parada por IA Sumida' });

    await expect(cardAtiva).toBeVisible();
    await expect(cardParada).toBeVisible();

    // 6. A tarefa ativa NÃO deve ter o selo de IA sumida
    await expect(cardAtiva.locator('.selo-ia-sumida')).toHaveCount(0);

    // 7. A tarefa parada DEVE ter o selo
    const selo = cardParada.locator('.selo-ia-sumida');
    await expect(selo).toBeVisible();
    await expect(selo).toContainText('Parada: sem checkpoint de Grok');

    // 8. Ao passar o mouse ou focar, mostra o motivo (reason)
    const motivo = selo.locator('.selo-ia-sumida-motivo');
    // Inicialmente oculto
    await expect(motivo).toBeHidden();

    // Passar mouse (hover)
    await selo.hover();
    await expect(motivo).toBeVisible();
    await expect(motivo).toContainText('A reserva de Grok em "Tarefa Parada por IA Sumida" venceu');

    // Mover mouse para fora
    await page.mouse.move(0, 0);
    await expect(motivo).toBeHidden();

    // Focar via teclado (focus)
    await selo.focus();
    await expect(motivo).toBeVisible();
    await expect(motivo).toContainText('não existe nenhum checkpoint dessa identidade nesta tarefa');
  });
});
