import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { medirLegibilidade } from './apoio/legibilidade';

/**
 * Frente "dono e cores": busca (12.1, 12.2), Quadro (5.1, 5.2) e Relações (7.1, 7.2, 7.3).
 * Sem page.route: os dados nascem de verdade pela API.
 */
const HEADERS = { 'X-Workspace-Client': 'local' };

async function criarProjeto(request: APIRequestContext, name: string) {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name, objective: 'Objetivo do teste.' } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function criarCartao(request: APIRequestContext, projectId: string, dados: Record<string, unknown>) {
  const res = await request.post(`/api/projects/${projectId}/board/cards`, { headers: HEADERS, data: { actor: 'Gemini', ...dados } });
  expect(res.ok()).toBeTruthy();
}

/** Cor "R,G,B" de um texto computado: grafite = os três canais próximos. */
function ehGrafite(cor: string): boolean {
  const [r, g, b] = (cor.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return Math.max(r, g, b) - Math.min(r, g, b) <= 14;
}

async function falhasDeLegibilidade(page: Page) {
  const resultado = await page.evaluate(medirLegibilidade);
  return [...resultado.falhasTamanho, ...resultado.falhasContraste];
}

/**
 * Espera a tela estar pronta para receber o atalho: o título da página desenhado e os efeitos do React já rodados
 * (é neles que o Ctrl K é ligado; apertar antes, logo depois do `goto`, perdia a tecla de vez em quando).
 */
async function esperarAppPronto(page: Page) {
  await expect(page.getByRole('heading', { name: /^Projetos/, level: 1 })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolver => requestAnimationFrame(() => setTimeout(resolver, 0))));
}

/** A caixa abre com uma animação curta de entrada; só se mede a posição depois que ela para (duas leituras iguais). */
async function esperarParar(caixa: Locator) {
  let anterior = Number.NaN;
  await expect.poll(async () => {
    const atual = (await caixa.boundingBox())!.y;
    const parou = atual === anterior;
    anterior = atual;
    return parou;
  }, { intervals: [150] }).toBe(true);
}

test.describe('12.1 e 12.2 — busca Ctrl K', () => {
  test('a caixa fica fixa a ~20% do topo, não pula ao digitar, e Esc devolve o foco ao botão Buscar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const abrir = page.locator('.command-trigger');
    await abrir.click();
    const caixa = page.locator('dialog.modal-paleta');
    await expect(caixa).toBeVisible();
    await esperarParar(caixa);
    const topoInicial = (await caixa.boundingBox())!.y;
    expect(topoInicial).toBeGreaterThan(900 * 0.15);
    expect(topoInicial).toBeLessThan(900 * 0.25);
    await page.getByLabel('Buscar comandos e projetos').fill('zzzz sem resultado');
    expect((await caixa.boundingBox())!.y).toBe(topoInicial);
    await page.keyboard.press('Escape');
    await expect(caixa).not.toBeVisible();
    await expect(abrir).toBeFocused();
  });

  test('abrir pelo atalho e fechar com Esc também devolve o foco a um lugar útil (o botão Buscar)', async ({ page }) => {
    await page.goto('/');
    await esperarAppPronto(page);
    await page.keyboard.press('Control+k');
    await expect(page.locator('dialog.modal-paleta')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.modal-paleta')).not.toBeVisible();
    await expect(page.locator('.command-trigger')).toBeFocused();
  });

  test('o anel de foco fica só na caixa: o campo de dentro não desenha outro anel', async ({ page }) => {
    await page.goto('/');
    await page.locator('.command-trigger').click();
    const campo = page.getByLabel('Buscar comandos e projetos');
    await expect(campo).toBeFocused();
    const campoOutline = await campo.evaluate(el => getComputedStyle(el).outlineStyle);
    const campoSombra = await campo.evaluate(el => getComputedStyle(el).boxShadow);
    expect(campoOutline).toBe('none');
    expect(campoSombra).toBe('none');
    // O anel da caixa acende com uma transição curta: espera o estilo chegar, sem trocar o que se exige dele.
    await expect.poll(() => page.locator('.command-search').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  });

  test('o filtro de projetos também tem o anel só na caixa', async ({ page, request }) => {
    await criarProjeto(request, 'Projeto para filtro ' + Date.now());
    await page.goto('/');
    // A lista chega logo depois da página e pode redesenhar o campo (o foco se perde): o foco é refeito a cada leitura.
    await expect.poll(async () => {
      await page.locator('#project-search').focus();
      return [
        await page.locator('#project-search').evaluate(el => getComputedStyle(el).outlineStyle),
        await page.locator('.library-search').evaluate(el => getComputedStyle(el).outlineStyle),
      ];
    }).toEqual(['none', 'solid']);
  });
});

test.describe('5.1 e 5.2 — Quadro', () => {
  test('etiquetas e avatares em grafite; prioridade Urgente em vermelho e Alta em brasa; legível', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Quadro Cores ' + Date.now());
    await criarCartao(request, p.id, { title: 'Cartão urgente com etiquetas', labels: ['bug', 'improvement', 'design', 'content'], priority: 'urgent' });
    await criarCartao(request, p.id, { title: 'Cartão alta prioridade', labels: ['test'], priority: 'high' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Quadro' })).toBeVisible();

    await expect(page.getByText('Cartão urgente com etiquetas')).toBeVisible();
    const etiquetas = page.locator('.quadro-etiqueta');
    expect(await etiquetas.count()).toBeGreaterThanOrEqual(5);
    for (const cor of await etiquetas.evaluateAll(els => els.map(el => getComputedStyle(el).color))) expect(ehGrafite(cor), cor).toBe(true);
    for (const cor of await page.locator('.quadro-avatar').evaluateAll(els => els.map(el => getComputedStyle(el).color))) expect(ehGrafite(cor), cor).toBe(true);

    const urgente = await page.locator('.quadro-prioridade[data-prioridade="urgent"]').first().evaluate(el => getComputedStyle(el).color);
    const [ur, ug, ub] = (urgente.match(/\d+/g) ?? []).map(Number);
    expect(ur).toBeGreaterThan(ug + 60);
    expect(ur).toBeGreaterThan(ub + 60);
    const alta = await page.locator('.quadro-prioridade[data-prioridade="high"]').first().evaluate(el => getComputedStyle(el).color);
    const [ar, ag, ab] = (alta.match(/\d+/g) ?? []).map(Number);
    expect(ar).toBeGreaterThan(ag);
    expect(ag).toBeGreaterThan(ab); // laranja-brasa, não âmbar nem vermelho puro
    expect(ag).toBeLessThan(210);

    expect(await falhasDeLegibilidade(page)).toEqual([]);
  });

  test('coluna cortada à direita: aparecem degradê e seta; a seta rola e some no fim; título tem dica', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Quadro Setas ' + Date.now());
    await criarCartao(request, p.id, { title: 'Cartão qualquer' });
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
    const trilho = page.locator('.quadro-trilho');
    await expect(trilho).toBeVisible();
    expect(await trilho.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    const direita = page.getByRole('button', { name: 'Ver mais colunas à direita' });
    await expect(direita).toBeVisible();
    await expect(page.locator('.quadro-borda-dir')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver colunas à esquerda' })).toHaveCount(0);
    // O toque real: o centro da seta é a própria seta (nada cobre) e o clique rola o trilho.
    expect(await direita.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
    await direita.dispatchEvent('click');
    await expect.poll(() => trilho.evaluate(el => el.scrollLeft)).toBeGreaterThan(200);
    await expect(page.getByRole('button', { name: 'Ver colunas à esquerda' })).toBeVisible();
    for (let i = 0; i < 6 && (await direita.count()) > 0; i++) { await direita.dispatchEvent('click'); await page.waitForTimeout(600); }
    await expect(direita).toHaveCount(0);
    const titulos = page.locator('.quadro-coluna-topo h3');
    expect(await titulos.count()).toBeGreaterThan(5);
    for (const titulo of await titulos.evaluateAll(els => els.map(el => [el.textContent, el.getAttribute('title')]))) expect(titulo[1]).toBe(titulo[0]);
  });

  test('numa tela larga em que tudo cabe, não aparece seta nem degradê', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Quadro Sem Seta ' + Date.now());
    await criarCartao(request, p.id, { title: 'Cartão qualquer' });
    await page.setViewportSize({ width: 2560, height: 1300 });
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
    await expect(page.locator('.quadro-trilho')).toBeVisible();
    await expect(page.getByRole('button', { name: /Ver mais colunas à direita/ })).toHaveCount(0);
  });
});

test.describe('7.1, 7.2 e 7.3 — Relações', () => {
  async function abrirRelacoes(page: Page, request: APIRequestContext) {
    const p = await criarProjeto(request, 'Relações ' + Date.now());
    for (let i = 1; i <= 26; i++) {
      const t = await request.post(`/api/projects/${p.id}/tasks`, { headers: HEADERS, data: { title: `Tarefa de relações ${i}` } });
      expect(t.ok()).toBeTruthy();
    }
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: /^Relações/ }).click();
    await expect(page.getByRole('heading', { name: 'Como as coisas se ligam' })).toBeVisible();
    return p;
  }

  test('português de produto e nenhum código hash na face dos cartões', async ({ page, request }) => {
    await abrirRelacoes(page, request);
    const corpo = (await page.locator('.graph-panel-container').innerText()).toLowerCase();
    for (const jargao of ['topologia', 'grafo de linhagem', 'jusante', 'precedente', 'canônicas', ' nós']) expect(corpo, jargao).not.toContain(jargao);
    expect(corpo).toContain('itens');
    const rostos = await page.locator('.graph-node-card').allInnerTexts();
    expect(rostos.length).toBeGreaterThan(0);
    for (const rosto of rostos) expect(rosto).not.toMatch(/\b[0-9a-f]{8}\b/);
  });

  test('cores em grafite: títulos das pistas e selos sem azul, roxo ou verde; legível', async ({ page, request }) => {
    await abrirRelacoes(page, request);
    for (const cor of await page.locator('.graph-lane-header .lane-header-left').evaluateAll(els => els.map(el => getComputedStyle(el).color))) expect(ehGrafite(cor), cor).toBe(true);
    for (const cor of await page.locator('.kpi-tag.ok').evaluateAll(els => els.map(el => getComputedStyle(el).color))) expect(ehGrafite(cor), cor).toBe(true);
    const ativo = await page.locator('.graph-subnav-btn.active').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(ehGrafite(ativo), ativo).toBe(true);
    expect(await falhasDeLegibilidade(page)).toEqual([]);
  });

  test('o painel de inspeção fica inteiro à vista depois de rolar, com o botão de ação (rola por dentro se for alto)', async ({ page, request }) => {
    await abrirRelacoes(page, request);
    await page.locator('.graph-node-card').first().click();
    const painel = page.locator('.graph-inspector-sidebar');
    await expect(painel).toBeVisible();
    await page.mouse.move(700, 300);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
    const topo = (await painel.boundingBox())!.y;
    expect(topo).toBeGreaterThanOrEqual(0);
    expect(topo).toBeLessThan(300);
    await expect(painel.getByRole('button', { name: 'Abrir na aba de origem' })).toBeInViewport();
  });
});

test.describe('8.1 — Biblioteca lê o Markdown', () => {
  test('título, negrito, lista e código aparecem formatados; HTML de IA vira texto, sem executar nada', async ({ page, request }) => {
    const p = await criarProjeto(request, 'Biblioteca Markdown ' + Date.now());
    const corpo = '# Arquitetura\n\n**Servidor:** Node com `tsx`.\n\n- primeiro item\n- segundo item\n\n```\nnpm run build\n```\n\n<script>window.__invadido = true</script>\n\n<img src=x onerror="window.__invadido = true">';
    const r = await request.post(`/api/projects/${p.id}/content`, { headers: HEADERS, data: { title: 'Arquitetura e pilha', kind: 'specification', body: corpo, createdBy: 'Gemini', sourceKind: 'agent_report' } });
    expect(r.ok()).toBeTruthy();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/#project/${p.id}`);
    await page.getByRole('tab', { name: 'Biblioteca', exact: true }).click();
    await page.locator('.library-item', { hasText: 'Arquitetura e pilha' }).click();
    const doc = page.locator('.library-document .md');
    await expect(doc.locator('h4')).toHaveText('Arquitetura');
    await expect(doc.locator('strong')).toHaveText('Servidor:');
    await expect(doc.locator('li')).toHaveCount(2);
    await expect(doc.locator('p code')).toHaveText('tsx');
    expect(await doc.locator('pre.md-codigo code').evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/mono|Consolas|Cascadia/i);
    await expect(doc).not.toContainText('# Arquitetura');
    await expect(doc).not.toContainText('**');
    // O HTML da IA aparece como texto e nunca como elemento.
    await expect(doc).toContainText('<script>window.__invadido = true</script>');
    expect(await doc.locator('script, img').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __invadido?: boolean }).__invadido)).toBeUndefined();
    expect(await falhasDeLegibilidade(page)).toEqual([]);
  });
});
