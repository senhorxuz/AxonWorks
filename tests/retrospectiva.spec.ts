import { test, expect, type APIRequestContext } from '@playwright/test';

const HEADERS = { 'X-Workspace-Client': 'local' };

async function ok<T>(resposta: Promise<{ ok(): boolean; json(): Promise<unknown>; text(): Promise<string> }>): Promise<T> {
  const r = await resposta;
  if (!r.ok()) throw new Error(`Preparação falhou: ${await r.text()}`);
  return (await r.json()) as T;
}

async function revisao(request: APIRequestContext, projectId: string): Promise<number> {
  const detalhe = await ok<{ project: { revision: number } }>(request.get(`/api/projects/${projectId}`));
  return detalhe.project.revision;
}

async function concluir(request: APIRequestContext, projectId: string, titulo: string, opcoes: { agent: string; summary: string; humanSummary?: string; evidence?: boolean; chave: string }) {
  const tarefa = await ok<{ id: string }>(request.post(`/api/projects/${projectId}/tasks`, { headers: HEADERS, data: { title: titulo } }));
  await ok(request.post(`/api/projects/${projectId}/tasks/${tarefa.id}/claim`, { headers: HEADERS, data: { agent: opcoes.agent, expectedVersion: 0 } }));
  await ok(request.post(`/api/projects/${projectId}/finalize`, {
    headers: HEADERS,
    data: {
      agent: opcoes.agent,
      expectedRevision: await revisao(request, projectId),
      idempotencyKey: opcoes.chave,
      summary: opcoes.summary,
      ...(opcoes.humanSummary ? { humanSummary: opcoes.humanSummary } : {}),
      nextStep: 'Seguir para a próxima entrega.',
      taskId: tarefa.id,
      taskTransition: { kind: 'declare_done' },
      decisions: [],
      blockers: [],
      evidence: opcoes.evidence ? [{ command: 'npm test', outcome: 'passed', details: 'Todos os testes passaram.' }] : [],
    },
  }));
}

test('retrospectiva conta a história do projeto só com dados reais', async ({ page, request }) => {
  const projeto = await ok<{ id: string; name: string }>(request.post('/api/projects', { headers: HEADERS, data: { name: 'Projeto Retrospectiva', objective: 'Contar o que já foi feito.' } }));

  await concluir(request, projeto.id, 'Primeira entrega', { agent: 'Astra', summary: 'Resumo técnico da primeira.', humanSummary: 'A primeira entrega ficou pronta para você usar.', evidence: true, chave: 'retro-1' });
  await ok(request.post(`/api/projects/${projeto.id}/checkpoints`, {
    headers: HEADERS,
    data: { agent: 'Gemini', expectedRevision: await revisao(request, projeto.id), idempotencyKey: 'retro-2', summary: 'Checkpoint intermediário.', nextStep: 'Concluir a segunda.' },
  }));
  await concluir(request, projeto.id, 'Segunda entrega', { agent: 'Gemini', summary: 'Rotas novas e testes de contrato.', chave: 'retro-3' });
  // Uma tarefa ainda aberta não entra na conta.
  await ok(request.post(`/api/projects/${projeto.id}/tasks`, { headers: HEADERS, data: { title: 'Ainda em aberto' } }));

  const antiga = await ok<{ id: string; version: number }>(request.post(`/api/projects/${projeto.id}/decisions`, { headers: HEADERS, data: { agent: 'Astra', title: 'Export em v2', body: 'Exportar no formato v2.' } }));
  const aceita = await ok<{ id: string; version: number }>(request.post(`/api/projects/${projeto.id}/decisions/${antiga.id}/accept`, { headers: HEADERS, data: { actor: 'Astra', expectedVersion: antiga.version } }));
  await ok(request.post(`/api/projects/${projeto.id}/decisions/${antiga.id}/supersede`, { headers: HEADERS, data: { actor: 'Astra', expectedVersion: aceita.version, title: 'Export em v3', body: 'Exportar no formato v3.' } }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#project/${projeto.id}`);
  await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Retrospectiva', exact: true }).click();

  const retro = page.getByRole('region', { name: `${projeto.name} até agora` });
  await expect(retro).toBeVisible();
  await expect(retro.locator('.retro-numero')).toHaveText('2');
  await expect(retro.locator('.retro-numero-rotulo')).toHaveText('tarefas concluídas');
  const fato = (nome: string) => retro.locator(`.retro-fato[data-fato="${nome}"]`);
  for (const [nome, valor, rotulo] of [
    ['checkpoints', '3', 'checkpoints salvos'],
    ['dias', '1', 'dia de trabalho'],
    ['ias', '2', 'IAs assinaram o trabalho'],
    ['decisoes', '1', 'decisão vale hoje'],
  ]) {
    await expect(fato(nome!).locator('dd')).toHaveText(valor!);
    await expect(fato(nome!).locator('dt')).toHaveText(rotulo!);
  }
  // Nenhuma evidência com arquivos conferidos: o fato não aparece, nem como zero.
  await expect(fato('conferidas')).toHaveCount(0);

  // Trilha: um traço por checkpoint, um ponto por entrega, percorrível pelo teclado.
  const trilha = retro.getByRole('group', { name: /Linha do tempo com 3 checkpoints/ });
  await expect(trilha.locator('.retro-marca')).toHaveCount(3);
  await expect(trilha.locator('.retro-marca[data-entrega]')).toHaveCount(2);
  const anuncio = retro.locator('.retro-trilha-anuncio');
  await trilha.focus();
  await page.keyboard.press('End');
  await expect(anuncio).toContainText('Concluiu Segunda entrega');
  await expect(anuncio).toContainText('Gemini');
  await expect(retro.locator('.retro-trilha-dica')).toContainText('Concluiu Segunda entrega');
  await page.keyboard.press('ArrowLeft');
  await expect(anuncio).toContainText('Checkpoint intermediário.');
  await page.keyboard.press('Home');
  await expect(anuncio).toContainText('Concluiu Primeira entrega');


  const entregas = page.getByRole('region', { name: 'Entregas' });
  const itens = entregas.getByRole('listitem');
  await expect(itens).toHaveCount(2);
  await expect(itens.nth(0)).toContainText('Segunda entrega');
  await expect(itens.nth(0)).toContainText('Rotas novas e testes de contrato.');
  await expect(itens.nth(0)).toContainText('Entregue por Gemini');
  await expect(itens.nth(0)).toContainText('Sem evidência registrada');
  await expect(itens.nth(1)).toContainText('A primeira entrega ficou pronta para você usar.');
  await expect(itens.nth(1)).not.toContainText('Resumo técnico da primeira.');
  await expect(itens.nth(1)).toContainText('Informado pela IA');

  // Passar o mouse numa entrega acende o ponto dela na trilha.
  await itens.nth(1).hover();
  await expect(trilha.locator('.retro-marca[data-destaque]')).toHaveCount(1);
  await expect(trilha.locator('.retro-marca[data-destaque]')).toHaveAttribute('data-tarefa', 'Primeira entrega');

  const pessoas = page.getByRole('region', { name: 'Quem entregou o quê' });
  await expect(pessoas.getByRole('listitem').nth(0)).toContainText('Gemini');
  await expect(pessoas.getByRole('listitem').nth(0)).toContainText('1 entrega e 2 checkpoints');
  await expect(pessoas.getByRole('listitem').nth(1)).toContainText('Astra');
  await expect(pessoas.getByRole('listitem').nth(1)).toContainText('1 entrega e 1 checkpoint');

  const decisoes = page.getByRole('region', { name: 'Decisões do rumo' });
  await expect(decisoes.getByRole('listitem')).toHaveCount(2);
  await expect(decisoes.getByRole('listitem').nth(0)).toContainText('Export em v2');
  await expect(decisoes.getByRole('listitem').nth(0)).toContainText('Substituída por Export em v3');
  await expect(decisoes.getByRole('listitem').nth(1)).toContainText('Export em v3');
  await expect(decisoes.getByRole('listitem').nth(1)).toContainText('Vale hoje');

  // Uma semana só: não existe "semana mais produtiva" para destacar.
  await expect(page.getByText('Semana mais produtiva')).toHaveCount(0);
});

test('projeto sem checkpoint mostra onde a história começa, sem números inventados', async ({ page, request }) => {
  const projeto = await ok<{ id: string; name: string }>(request.post('/api/projects', { headers: HEADERS, data: { name: 'Projeto Recém-criado', objective: 'Ainda sem trabalho.' } }));
  await page.goto(`/#project/${projeto.id}`);
  await page.getByRole('tab', { name: 'Retrospectiva', exact: true }).click();
  await expect(page.getByText('A retrospectiva começa no primeiro checkpoint.')).toBeVisible();
  await expect(page.locator('.retro-numero')).toHaveCount(0);
  await expect(page.locator('.retro-trilha')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Entregas' })).toHaveCount(0);
});

test('com movimento reduzido, o número principal já aparece inteiro, sem animação', async ({ page, request }) => {
  const projeto = await ok<{ id: string }>(request.post('/api/projects', { headers: HEADERS, data: { name: 'Projeto Calmo', objective: 'Sem movimento.' } }));
  await concluir(request, projeto.id, 'Entrega calma', { agent: 'Astra', summary: 'Pronto.', chave: 'retro-calma' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/#project/${projeto.id}`);
  await page.getByRole('tab', { name: 'Retrospectiva', exact: true }).click();
  const numero = page.locator('.retro-numero');
  await expect(numero).toHaveText('1');
  const estilo = await numero.evaluate(el => {
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, transform: cs.transform, animacoes: el.getAnimations().length };
  });
  expect(estilo).toEqual({ opacity: '1', transform: 'none', animacoes: 0 });
});
