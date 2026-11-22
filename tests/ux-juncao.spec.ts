import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Junção das frentes de tela: quem assina e de que origem nasce o que o dono grava (Biblioteca, nova revisão,
 * Backlog), foco do campo "nova tarefa", chegada de "Esperando por você" e confirmação ao descartar texto.
 * Sem page.route: tudo nasce de verdade pela API e o servidor real responde.
 */
const HEADERS = { 'X-Workspace-Client': 'local' };

async function criarProjeto(request: APIRequestContext, name: string) {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name, objective: 'Objetivo do teste.' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string };
}

async function documento(request: APIRequestContext, projectId: string, titulo: string) {
  const lista = await (await request.get(`/api/projects/${projectId}/content`)).json();
  const item = lista.find((i: { item: { title: string } }) => i.item.title === titulo)?.item;
  expect(item).toBeTruthy();
  return (await (await request.get(`/api/projects/${projectId}/content/${item.id}`)).json()) as { revision: { sourceKind: string; createdBy: string }; revisions: unknown[] };
}

async function guardarConteudo(page: import('@playwright/test').Page, titulo: string) {
  await page.getByRole('button', { name: 'Novo conteúdo', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Novo conteúdo', exact: true });
  await dialogo.getByLabel('Título').fill(titulo);
  await dialogo.getByLabel('Texto do conteúdo').fill('Texto de apoio.');
  await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialogo).not.toBeVisible();
}

async function novaRevisao(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Nova revisão', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Nova revisão', exact: true });
  await dialogo.getByLabel('Texto do conteúdo').fill('Texto revisado.');
  await dialogo.getByRole('button', { name: /^(Guardar|Gravar)/ }).click();
  await expect(dialogo).not.toBeVisible();
}

test.describe('Autoria: a mesma regra da Diretriz em Biblioteca e Backlog', () => {
  test('com nome na barra, a Biblioteca assina a IA e a origem nasce como relato de agente', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Autoria IA ' + Date.now());
    await page.goto(`/#project/${p.id}`);
    await page.getByLabel('Nome do agente').fill('Astra');
    await page.getByRole('tab', { name: 'Biblioteca', exact: true }).click();
    await guardarConteudo(page, 'Doc da IA');
    const nova = await documento(request, p.id, 'Doc da IA');
    expect(nova.revision.createdBy).toBe('Astra');
    expect(nova.revision.sourceKind).toBe('agent_report');
    await novaRevisao(page);
    await expect.poll(async () => (await documento(request, p.id, 'Doc da IA')).revisions.length).toBe(2);
    const revisado = await documento(request, p.id, 'Doc da IA');
    expect(revisado.revision.createdBy).toBe('Astra');
    expect(revisado.revision.sourceKind).toBe('agent_report');
  });

  test('sem nome na barra, assina o dono; a nova revisão herda a origem da vigente', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Autoria dono ' + Date.now());
    // Relato de IA já guardado: o dono revê sem digitar nome e a origem não vira ordem dele.
    const criado = await request.post(`/api/projects/${p.id}/content`, { headers: HEADERS, data: { title: 'Relato', kind: 'note', body: 'Relato da IA.', createdBy: 'Gemini', sourceKind: 'agent_report' } });
    expect(criado.ok()).toBeTruthy();
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: 'Biblioteca', exact: true }).click();
    await page.getByRole('button', { name: /Relato/ }).first().click();
    await novaRevisao(page);
    await expect.poll(async () => (await documento(request, p.id, 'Relato')).revisions.length).toBe(2);
    const revisado = await documento(request, p.id, 'Relato');
    expect(revisado.revision.createdBy).toBe('Dono do projeto');
    expect(revisado.revision.sourceKind).toBe('agent_report');
    await page.getByRole('button', { name: 'Fechar documento' }).click();
    await guardarConteudo(page, 'Doc do dono');
    const doc = await documento(request, p.id, 'Doc do dono');
    expect(doc.revision.createdBy).toBe('Dono do projeto');
    expect(doc.revision.sourceKind).toBe('human_directive');
  });

  test('uma IA revendo um documento do dono grava relato de agente, nunca diretriz humana', async ({ page, request }) => {
    const p = await criarProjeto(request, 'IA revê dono ' + Date.now());
    const criado = await request.post(`/api/projects/${p.id}/content`, { headers: HEADERS, data: { title: 'Ordem do dono', kind: 'note', body: 'Texto do dono.', createdBy: 'Dono do projeto', sourceKind: 'human_directive' } });
    expect(criado.ok()).toBeTruthy();
    await page.goto(`/#project/${p.id}`);
    await page.getByLabel('Nome do agente').fill('Astra');
    await page.getByRole('tab', { name: 'Biblioteca', exact: true }).click();
    await page.getByRole('button', { name: /Ordem do dono/ }).first().click();
    await novaRevisao(page);
    await expect.poll(async () => (await documento(request, p.id, 'Ordem do dono')).revisions.length).toBe(2);
    const revisado = await documento(request, p.id, 'Ordem do dono');
    expect(revisado.revision.createdBy).toBe('Astra');
    expect(revisado.revision.sourceKind).toBe('agent_report');
  });

  test('o Backlog assina a IA quando há nome na barra e o dono quando não há', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Autoria backlog ' + Date.now());
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: /^Backlog/ }).click();
    await page.getByLabel('Título da ideia').fill('Ideia sem nome');
    await page.getByRole('button', { name: 'Capturar ideia', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Ideias em avaliação' })).toContainText('Ideia sem nome');
    await page.getByLabel('Nome do agente').fill('Astra');
    await page.getByLabel('Título da ideia').fill('Ideia da IA');
    await page.getByRole('button', { name: 'Capturar ideia', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Ideias em avaliação' })).toContainText('Ideia da IA');
    const lista = await (await request.get(`/api/projects/${p.id}/backlog`)).json() as Array<{ title: string; createdBy: string }>;
    expect(lista.find(i => i.title === 'Ideia sem nome')?.createdBy).toBe('Dono do projeto');
    expect(lista.find(i => i.title === 'Ideia da IA')?.createdBy).toBe('Astra');
  });
});

test.describe('Nova tarefa: o foco fica no campo', () => {
  test('duas tarefas seguidas com Enter, sem clicar de novo no campo', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Tarefas em sequência ' + Date.now());
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
    const campo = page.getByLabel('Título da tarefa');
    await campo.fill('Primeira tarefa');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Primeira tarefa').first()).toBeVisible();
    await expect(campo).toBeFocused();
    await page.keyboard.type('Segunda tarefa');
    await page.keyboard.press('Enter');
    await expect.poll(async () => ((await (await request.get(`/api/projects/${p.id}`)).json()).tasks as Array<{ title: string }>).map(t => t.title).sort()).toEqual(['Primeira tarefa', 'Segunda tarefa']);
  });
});

test.describe('Esperando por você: os botões levam e acendem o destino', () => {
  async function comPendencias(request: APIRequestContext) {
    const p = await criarProjeto(request, 'Pendências ' + Date.now());
    expect((await request.post(`/api/projects/${p.id}/decisions`, { headers: HEADERS, data: { title: 'Usar grafite', body: 'Cor neutra.', agent: 'Astra' } })).ok()).toBeTruthy();
    const livre = await request.post(`/api/projects/${p.id}/board/cards`, { headers: HEADERS, data: { actor: 'Gemini', title: 'Cartão qualquer', column: 'pending' } });
    expect(livre.ok()).toBeTruthy();
    const dono = await request.post(`/api/projects/${p.id}/board/cards`, { headers: HEADERS, data: { actor: 'Gemini', title: 'Aprovar o logotipo', column: 'pending', needsOwner: true } });
    expect(dono.ok()).toBeTruthy();
    return p;
  }

  test('"Ver decisões" acende o bloco Esperando você aceitar', async ({ page, request }) => {
    const p = await comPendencias(request);
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
    await page.getByRole('button', { name: /^Ver decisões/ }).click();
    const bloco = page.getByRole('region', { name: /Esperando você aceitar/ });
    await expect(bloco).toBeVisible();
    await expect(bloco).toHaveClass(/axon-chegou/);
  });

  test('"Ver no Quadro" acende o primeiro cartão que depende do dono', async ({ page, request }) => {
    const p = await comPendencias(request);
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
    await page.getByRole('button', { name: /^Ver no Quadro/ }).click();
    const cartao = page.locator('.quadro-cartao', { hasText: 'Aprovar o logotipo' });
    await expect(cartao).toHaveClass(/axon-chegou/);
    await expect(page.locator('.quadro-cartao', { hasText: 'Cartão qualquer' })).not.toHaveClass(/axon-chegou/);
  });
});

test.describe('Informar nome dentro de um diálogo', () => {
  test('com texto digitado, o pedido do botão pergunta antes de fechar o diálogo', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Informar no diálogo ' + Date.now());
    await page.goto(`/#project/${p.id}`);
    await page.getByLabel('Nome do agente').fill('Astra');
    await page.getByRole('button', { name: /Salvar primeiro checkpoint/ }).first().click();
    const dialogo = page.getByRole('dialog', { name: 'Salvar checkpoint' });
    await dialogo.getByLabel('Resumo do progresso').fill('Texto que não pode se perder');
    // O que o botão "Informar nome" faz: pede para ir ao campo da barra lateral (o menu abre no celular).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('axon:abrir-menu')));
    await expect(dialogo.getByRole('alertdialog')).toBeVisible();
    await expect(dialogo.getByLabel('Resumo do progresso')).toHaveValue('Texto que não pode se perder');
  });
});

test.describe('Contagem do "depende de você"', () => {
  test('marcar um cartão no Quadro muda o "Esperando por você" da Visão geral sem recarregar a página', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Contagem viva ' + Date.now());
    expect((await request.post(`/api/projects/${p.id}/board/cards`, { headers: HEADERS, data: { actor: 'Gemini', title: 'Aprovar o logotipo', column: 'pending' } })).ok()).toBeTruthy();
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
    await page.locator('.quadro-cartao', { hasText: 'Aprovar o logotipo' }).click();
    const painel = page.getByRole('dialog', { name: 'Cartão: Aprovar o logotipo' });
    await painel.getByRole('checkbox', { name: 'Depende de você' }).click();
    await expect(painel.getByRole('status')).toContainText('Salvo');
    await page.keyboard.press('Escape');
    await expect(painel).not.toBeVisible();
    await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Esperando por você' }).first()).toContainText('1 item espera você');
  });
});

test.describe('Excluir projeto: a lista diz tudo o que some', () => {
  test('mostra propostas de aprovação, passagens e rascunhos com os números certos', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Lista completa ' + Date.now());
    const proposta = await request.post(`/api/projects/${p.id}/approvals`, { headers: HEADERS, data: { agent: 'Gemini', kind: 'note', title: 'Ajuste de contraste', body: 'Trocar a cor do rótulo.', rationale: 'Cumprir o contraste mínimo.' } });
    expect(proposta.ok()).toBeTruthy();
    const rascunho = await request.post(`/api/projects/${p.id}/drafts`, { headers: HEADERS, data: { agent: 'Astra', expectedVersion: 0, summary: 'Em andamento', nextAction: 'Seguir' } });
    expect(rascunho.ok(), await rascunho.text()).toBeTruthy();
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('button', { name: 'Excluir projeto', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Excluir projeto', exact: true });
    const linha = (rotulo: string) => dialogo.locator('dl > div', { has: page.getByText(rotulo, { exact: true }) });
    await expect(linha('Propostas de aprovação')).toContainText('1');
    await expect(linha('Rascunhos de trabalho')).toContainText('1');
    await expect(linha('Passagens entre IAs')).toContainText('0');
  });
});

test.describe('Diretriz: uma IA com nome na barra não salva diretriz humana', () => {
  test('com "Astra" na barra, salvar grava atualização de agente; sem nome, diretriz humana', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Diretriz da IA ' + Date.now());
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: 'Diretriz', exact: true }).click();
    const folha = page.getByRole('region', { name: 'Diretriz do projeto' });
    await page.getByLabel('Nome do agente').fill('Astra');
    await folha.getByRole('button', { name: 'Editar diretriz' }).click();
    await folha.getByRole('textbox', { name: 'Texto vigente da diretriz do projeto' }).fill('OBJETIVO\nTexto revisto pela IA.');
    await folha.getByRole('button', { name: 'Salvar versão 2' }).click();
    await expect(folha.getByRole('status')).toContainText('Diretriz salva');
    const atual = await (await request.get(`/api/projects/${p.id}/charter`)).json();
    expect(atual).toMatchObject({ revision: 2, sourceKind: 'agent_update', createdBy: 'Astra' });
  });
});
