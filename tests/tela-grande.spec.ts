import { test, expect } from '@playwright/test';

const HEADERS = { 'X-Workspace-Client': 'local' };

test('em monitor QHD, as páginas usam a largura da tela em vez de uma faixa estreita no meio', async ({ page, request }) => {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name: 'Projeto Tela Grande', objective: 'Aproveitar o monitor.' } });
  expect(res.ok()).toBeTruthy();
  const projeto = await res.json();

  await page.setViewportSize({ width: 2560, height: 1440 });
  for (const rota of ['/#projects', `/#project/${projeto.id}`]) {
    await page.goto(rota);
    const principal = page.locator('#main-content');
    await expect(principal).toBeVisible();
    const largura = (await principal.boundingBox())!.width;
    expect(largura, `${rota}: o conteúdo precisa ocupar a tela grande`).toBeGreaterThan(2000);
  }

  // No notebook, nada muda: o conteúdo continua com o limite confortável de leitura.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#project/${projeto.id}`);
  const larguraNotebook = (await page.locator('#main-content').boundingBox())!.width;
  expect(larguraNotebook).toBeLessThanOrEqual(1320);
});

test('em monitor QHD, Resumo, Retrospectiva e Guia preenchem a largura sem deixar faixa vazia à direita', async ({ page, request }) => {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name: 'Projeto Espaço Vazio', objective: 'Sem sobra à direita.' } });
  const projeto = await res.json();
  const tarefa = await (await request.post(`/api/projects/${projeto.id}/tasks`, { headers: HEADERS, data: { title: 'Entrega para o resumo' } })).json();
  expect((await request.post(`/api/projects/${projeto.id}/tasks/${tarefa.id}/claim`, { headers: HEADERS, data: { agent: 'Astra', expectedVersion: 0 } })).ok()).toBeTruthy();
  expect((await request.post(`/api/projects/${projeto.id}/finalize`, { headers: HEADERS, data: {
    agent: 'Astra', expectedRevision: 0, idempotencyKey: 'tela-grande-1', summary: 'Pronto.', humanSummary: 'Ficou pronto.',
    nextStep: 'Seguir.', taskId: tarefa.id, taskTransition: { kind: 'declare_done' },
  } })).ok()).toBeTruthy();
  expect((await request.post(`/api/projects/${projeto.id}/approvals`, { headers: HEADERS, data: {
    agent: 'Gemini', kind: 'note', title: 'Uma proposta', body: 'Corpo.', rationale: 'Motivo.',
  } })).ok()).toBeTruthy();

  await page.setViewportSize({ width: 2560, height: 1440 });

  // Visão geral: as seções do resumo chegam até perto da borda direita do cartão.
  await page.goto(`/#project/${projeto.id}`);
  const resumo = page.locator('.resumo-ao-acordar');
  await expect(resumo.locator('.resumo-secao').first()).toBeVisible();
  const sobraResumo = await resumo.evaluate(el => {
    const caixa = el.getBoundingClientRect();
    const direitaDoConteudo = caixa.right - parseFloat(getComputedStyle(el).paddingRight);
    const maisADireita = Math.max(...[...el.querySelectorAll(':scope > .resumo-secao')].map(s => s.getBoundingClientRect().right));
    return direitaDoConteudo - maisADireita;
  });
  expect(sobraResumo, 'sobra vazia à direita das seções do resumo').toBeLessThan(40);

  // Retrospectiva: ocupa a largura e põe as seções lado a lado.
  await page.getByRole('tab', { name: 'Retrospectiva', exact: true }).click();
  const retro = page.locator('.retro');
  await expect(retro.locator('.retro-entregas')).toBeVisible();
  expect((await retro.boundingBox())!.width, 'retrospectiva usa a largura').toBeGreaterThan(2000);
  const entregas = (await retro.locator('.retro-entregas').boundingBox())!;
  const pessoas = (await retro.locator('.retro-pessoas').boundingBox())!;
  expect(pessoas.x, '"Quem entregou o quê" fica ao lado das entregas').toBeGreaterThan(entregas.x + entregas.width - 1);

  // Guia: os passos dividem a largura em colunas.
  await page.goto('/#guide');
  const guia = page.locator('.guide-list');
  await expect(guia).toBeVisible();
  expect((await guia.boundingBox())!.width, 'guia usa a largura').toBeGreaterThan(2000);
  const passos = guia.locator('article');
  expect((await passos.nth(1).boundingBox())!.y, 'o segundo passo fica ao lado do primeiro').toBeLessThan((await passos.nth(0).boundingBox())!.y + 5);
});
