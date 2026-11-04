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
  // A fonte da interface carrega depois da página: mede-se a posição final, a que a pessoa vê.
  await page.evaluate(() => document.fonts.ready);
  expect((await guia.boundingBox())!.width, 'guia usa a largura').toBeGreaterThan(2000);
  const passos = guia.locator('article');
  expect((await passos.nth(1).boundingBox())!.y, 'o segundo passo fica ao lado do primeiro').toBeLessThan((await passos.nth(0).boundingBox())!.y + 5);
});

// ---- Monitores de 24" (1920 x 1080) e 27" (2560 x 1440) ----

const COLUNAS_CHEIAS = ['ideas', 'pending', 'in_progress', 'unfinished', 'testing', 'awaiting_deploy', 'done', 'blocked'];

async function projetoComQuadro(request: import('@playwright/test').APIRequestContext, nome: string) {
  const projeto = await (await request.post('/api/projects', { headers: HEADERS, data: { name: nome, objective: 'Monitor grande.' } })).json();
  for (const column of COLUNAS_CHEIAS) {
    const r = await request.post(`/api/projects/${projeto.id}/board/cards`, { headers: HEADERS, data: { actor: 'Gemini', title: `Cartão em ${column}`, column } });
    expect(r.ok()).toBeTruthy();
  }
  return projeto as { id: string };
}

test('no 27" (2560 px) a tela inteira fica 15% maior, para o texto ter o tamanho que tem no 24"; no 24" e no notebook nada muda', async ({ page }) => {
  const ampliacao = () => page.evaluate(() => (document.documentElement as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1);
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/#projects');
  await expect(page.locator('#main-content')).toBeVisible();
  expect(await ampliacao()).toBeCloseTo(1.15, 2);

  for (const tela of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(tela);
    await page.goto('/#projects');
    await expect(page.locator('#main-content')).toBeVisible();
    expect(await ampliacao(), `${tela.width} px`).toBe(1);
  }
});

test('no 27", o Quadro mostra todas as colunas sem rolar para o lado e termina dentro da janela', async ({ page, request }) => {
  const projeto = await projetoComQuadro(request, 'Quadro no 27');
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto(`/#project/${projeto.id}`);
  await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
  const trilho = page.locator('.quadro-trilho');
  await expect(trilho.locator('.quadro-cartao')).toHaveCount(COLUNAS_CHEIAS.length);
  const medida = await trilho.evaluate(el => ({ sobra: el.scrollWidth - el.clientWidth, fundo: el.getBoundingClientRect().bottom, janela: innerHeight }));
  expect(medida.sobra, 'colunas escondidas à direita').toBeLessThanOrEqual(1);
  expect(medida.fundo, 'o quadro passa do fim da janela').toBeLessThanOrEqual(medida.janela);
  const cortados = await trilho.locator('.quadro-coluna-topo h3').evaluateAll(hs => hs.filter(h => h.scrollWidth > h.clientWidth + 1).map(h => h.textContent));
  expect(cortados, 'títulos de coluna cortados com reticências').toEqual([]);
});

test('no 24", o Quadro mostra pelo menos 7 colunas sem rolar', async ({ page, request }) => {
  const projeto = await projetoComQuadro(request, 'Quadro no 24');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/#project/${projeto.id}`);
  await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
  const trilho = page.locator('.quadro-trilho');
  await expect(trilho.locator('.quadro-cartao')).toHaveCount(COLUNAS_CHEIAS.length);
  const visiveis = await trilho.evaluate(el => {
    const caixa = el.getBoundingClientRect();
    return [...el.querySelectorAll(':scope > .quadro-coluna')].filter(c => c.getBoundingClientRect().right <= caixa.right + 1).length;
  });
  expect(visiveis).toBeGreaterThanOrEqual(7);
  const cortados = await trilho.locator('.quadro-coluna-topo h3').evaluateAll(hs => hs.filter(h => h.scrollWidth > h.clientWidth + 1).map(h => h.textContent));
  expect(cortados, 'títulos de coluna cortados com reticências').toEqual([]);
});

test('no 27", o cartão arrastado acompanha o ponteiro e mantém a largura', async ({ page, request }) => {
  const projeto = await projetoComQuadro(request, 'Arrastar no 27');
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto(`/#project/${projeto.id}`);
  await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
  const cartao = page.locator('.quadro-cartao', { hasText: 'Cartão em ideas' });
  const caixa = (await cartao.boundingBox())!;
  const inicio = { x: caixa.x + 30, y: caixa.y + 15 };
  await page.mouse.move(inicio.x, inicio.y);
  await page.mouse.down();
  await page.mouse.move(inicio.x + 150, inicio.y + 40, { steps: 6 });
  await page.mouse.move(inicio.x + 300, inicio.y + 80, { steps: 6 });
  const fantasma = page.locator('.quadro-fantasma');
  await expect(fantasma).toBeVisible();
  await page.waitForTimeout(300);
  const f = (await fantasma.boundingBox())!;
  expect(Math.abs(f.x - (caixa.x + 300)), 'fantasma longe do ponteiro na horizontal').toBeLessThan(6);
  expect(Math.abs(f.y - (caixa.y + 80)), 'fantasma longe do ponteiro na vertical').toBeLessThan(10);
  expect(Math.abs(f.width - caixa.width), 'fantasma com outra largura').toBeLessThan(6);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('no 24" e no 27", Onde paramos põe "O que foi feito" e "O que falta" lado a lado; no notebook, um abaixo do outro', async ({ page, request }) => {
  const projeto = await projetoComQuadro(request, 'Carta lado a lado');
  await request.post(`/api/projects/${projeto.id}/checkpoints`, { headers: HEADERS, data: {
    agent: 'Gemini', expectedRevision: 0, idempotencyKey: 'carta-lado-1', summary: 'Feito.', humanSummary: 'O login ficou pronto.', nextStep: 'Seguir.',
  } });
  const posicoes = async () => {
    await page.goto(`/#project/${projeto.id}`);
    await page.getByRole('tab', { name: 'Onde paramos', exact: true }).click();
    const feito = (await page.locator('.carta-bloco-feito').boundingBox())!;
    const falta = (await page.locator('.carta-bloco-falta').boundingBox())!;
    return { feito, falta };
  };
  for (const tela of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    await page.setViewportSize(tela);
    const { feito, falta } = await posicoes();
    expect(falta.x, `${tela.width} px: "O que falta" ao lado`).toBeGreaterThan(feito.x + feito.width - 1);
    expect(Math.abs(falta.y - feito.y), `${tela.width} px: mesma altura`).toBeLessThan(2);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const { feito, falta } = await posicoes();
  expect(falta.y, 'notebook: "O que falta" abaixo').toBeGreaterThan(feito.y + feito.height - 1);
});

test('no 27", a ampliação não cria rolagem falsa: página curta não rola, e o painel do cartão e as janelas cabem na tela', async ({ page, request }) => {
  const projeto = await projetoComQuadro(request, 'Sem rolagem falsa');
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/#projects');
  await expect(page.locator('#main-content')).toBeVisible();
  // Filtro sem resultado: a página fica curta, não importa quantos projetos outros testes criaram.
  await page.getByPlaceholder('Filtrar projetos').fill('nenhum-projeto-tem-este-nome');
  await page.waitForTimeout(300);
  const rolou = await page.evaluate(() => { window.scrollTo(0, 99999); return window.scrollY; });
  expect(rolou, 'a página está curta e não deveria rolar').toBe(0);

  await page.goto(`/#project/${projeto.id}`);
  await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
  await page.locator('.quadro-cartao', { hasText: 'Cartão em ideas' }).click();
  const painel = page.locator('.quadro-painel');
  await expect(painel).toBeVisible();
  await page.waitForTimeout(500);
  const caixa = (await painel.boundingBox())!;
  expect(caixa.y + caixa.height, 'o painel do cartão passa do fim da tela').toBeLessThanOrEqual(1441);
});

test('Resumo ao acordar: as seções são blocos lado a lado, da mesma altura, e "Esperando por você" mostra o número grande', async ({ page, request }) => {
  const projeto = await (await request.post('/api/projects', { headers: HEADERS, data: { name: 'Resumo em blocos', objective: 'Blocos.' } })).json();
  for (const titulo of ['Proposta um', 'Proposta dois']) {
    expect((await request.post(`/api/projects/${projeto.id}/approvals`, { headers: HEADERS, data: {
      agent: 'Gemini', kind: 'note', title: titulo, body: 'Corpo.', rationale: 'Motivo.',
    } })).ok()).toBeTruthy();
  }
  for (const tela of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(tela);
    await page.goto(`/#project/${projeto.id}`);
    await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
    const pronto = page.locator('.resumo-secao[aria-label="Ficou pronto"]');
    const esperando = page.locator('.resumo-secao[aria-label="Esperando por você"]');
    await expect(esperando).toBeVisible();
    const a = (await pronto.boundingBox())!;
    const b = (await esperando.boundingBox())!;
    expect(b.x, `${tela.width} px: lado a lado`).toBeGreaterThan(a.x + a.width - 1);
    expect(Math.abs(a.y - b.y), `${tela.width} px: mesma linha`).toBeLessThan(2);
    expect(Math.abs(a.height - b.height), `${tela.width} px: mesma altura`).toBeLessThan(2);
    expect(await esperando.evaluate(el => getComputedStyle(el).backgroundColor), 'bloco com fundo próprio').not.toBe('rgba(0, 0, 0, 0)');
    await expect(esperando.locator('.resumo-numero')).toHaveText('2');
  }
});
