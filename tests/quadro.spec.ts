import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const HEADERS = { 'X-Workspace-Client': 'local' };

type Cartao = { id: string; column: string; version: number; title: string; labels: string[]; priority: string | null; needsOwner: boolean; checklist: Array<{ id: string; text: string; done: boolean }> };

async function ok<T>(resposta: Promise<{ ok(): boolean; json(): Promise<unknown>; text(): Promise<string> }>): Promise<T> {
  const r = await resposta;
  if (!r.ok()) throw new Error(`Preparação falhou: ${await r.text()}`);
  return (await r.json()) as T;
}

async function projeto(request: APIRequestContext, nome: string) {
  return ok<{ id: string; name: string }>(request.post('/api/projects', { headers: HEADERS, data: { name: nome, objective: 'Organizar o trabalho em cartões.' } }));
}

async function criarCartao(request: APIRequestContext, projectId: string, dados: Record<string, unknown>) {
  return ok<Cartao>(request.post(`/api/projects/${projectId}/board/cards`, { headers: HEADERS, data: { actor: 'Gemini', ...dados } }));
}

async function quadro(request: APIRequestContext, projectId: string) {
  return ok<{ cards: Cartao[] }>(request.get(`/api/projects/${projectId}/board`));
}

async function abrirQuadro(page: Page, projectId: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#project/${projectId}`);
  await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Quadro' })).toBeVisible();
}

test('quadro mostra as 9 etapas, recolhe Bloqueado e Descartado vazios e cria cartão pela tela', async ({ page, request }) => {
  const p = await projeto(request, 'Quadro Criar');
  await abrirQuadro(page, p.id);

  for (const nome of ['Ideias', 'Pendente', 'Em andamento', 'Inacabado', 'Em teste', 'Testado, falta deploy', 'Completo']) {
    await expect(page.getByRole('region', { name: nome, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Abrir coluna Bloqueado, vazia' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir coluna Descartado, vazia' })).toBeVisible();
  await expect(page.getByText('Nenhum cartão ainda. Comece escrevendo um em Pendente.')).toBeVisible();

  await page.getByRole('button', { name: 'Novo cartão' }).click();
  const campo = page.getByLabel('Título do cartão em Pendente');
  await campo.fill('Criar tela de login');
  await campo.press('Enter');

  const pendente = page.getByRole('region', { name: 'Pendente', exact: true });
  await expect(pendente.locator('.quadro-cartao')).toHaveCount(1);
  await expect(pendente.locator('.quadro-cartao')).toContainText('Criar tela de login');
  await expect(page.getByText('1 cartão.', { exact: true })).toBeVisible();

  const salvo = await quadro(request, p.id);
  expect(salvo.cards.map(c => [c.title, c.column])).toEqual([['Criar tela de login', 'pending']]);
});

test('arrastar com o mouse move o cartão de coluna, e o servidor confirma', async ({ page, request }) => {
  const p = await projeto(request, 'Quadro Arrastar');
  const cartao = await criarCartao(request, p.id, { title: 'Ajustar cores do painel', column: 'pending' });
  await abrirQuadro(page, p.id);

  const origem = page.locator(`[data-card-id="${cartao.id}"]`);
  const caixa = (await origem.boundingBox())!;
  const destino = (await page.locator('.quadro-coluna[data-coluna="in_progress"] .quadro-coluna-lista').boundingBox())!;
  await page.mouse.move(caixa.x + 30, caixa.y + 20);
  await page.mouse.down();
  await page.mouse.move(caixa.x + 50, caixa.y + 40, { steps: 5 });
  await page.mouse.move(destino.x + destino.width / 2, destino.y + 30, { steps: 15 });
  await expect(page.locator('.quadro-coluna[data-coluna="in_progress"]')).toHaveAttribute('data-alvo', '');
  await page.mouse.up();

  await expect(page.locator('.quadro-coluna[data-coluna="in_progress"]').locator(`[data-card-id="${cartao.id}"]`)).toBeVisible();
  await expect.poll(async () => (await quadro(request, p.id)).cards.find(c => c.id === cartao.id)?.column).toBe('in_progress');
});

test('pelo teclado, Alt + seta move o cartão e mantém o foco nele', async ({ page, request }) => {
  const p = await projeto(request, 'Quadro Teclado');
  const cartao = await criarCartao(request, p.id, { title: 'Revisar textos da home', column: 'pending' });
  await abrirQuadro(page, p.id);

  const face = page.locator(`[data-card-id="${cartao.id}"]`);
  await face.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('.quadro-coluna[data-coluna="in_progress"]').locator(`[data-card-id="${cartao.id}"]`)).toBeFocused();
  await expect(page.locator('.quadro-anuncio')).toHaveText('Movido para Em andamento');
  await expect.poll(async () => (await quadro(request, p.id)).cards.find(c => c.id === cartao.id)?.column).toBe('in_progress');
});

test('no painel do cartão: etiqueta, prioridade, lista de verificação e histórico salvam de verdade', async ({ page, request }) => {
  const p = await projeto(request, 'Quadro Painel');
  const cartao = await criarCartao(request, p.id, { title: 'Publicar versão nova', column: 'testing' });
  await abrirQuadro(page, p.id);

  await page.locator(`[data-card-id="${cartao.id}"]`).click();
  const painel = page.getByRole('dialog', { name: 'Cartão: Publicar versão nova' });
  await expect(painel).toBeVisible();

  await painel.getByRole('button', { name: 'Bug' }).click();
  await expect(painel.getByRole('button', { name: 'Bug' })).toHaveAttribute('aria-pressed', 'true');
  await painel.getByRole('radio', { name: 'Urgente' }).click();
  await expect(painel.getByRole('radio', { name: 'Urgente' })).toHaveAttribute('aria-checked', 'true');
  await painel.getByLabel('Adicionar item à lista de verificação').fill('Rodar os testes');
  await painel.getByRole('button', { name: 'Adicionar item' }).click();
  await painel.getByRole('checkbox', { name: 'Rodar os testes' }).click();
  await expect(painel.getByRole('checkbox', { name: 'Rodar os testes' })).toHaveAttribute('aria-checked', 'true');
  await expect(painel.getByText('1 de 1')).toBeVisible();
  await expect(painel.locator('.quadro-painel-eventos')).toContainText('Concluiu: Rodar os testes');

  await painel.getByRole('button', { name: 'Fechar cartão' }).click();
  const face = page.locator(`[data-card-id="${cartao.id}"]`);
  await expect(face).toContainText('Bug');
  await expect(face).toContainText('Urgente');
  await expect(face).toContainText('1/1');

  const salvo = (await quadro(request, p.id)).cards.find(c => c.id === cartao.id)!;
  expect(salvo.labels).toEqual(['bug']);
  expect(salvo.priority).toBe('urgent');
  expect(salvo.checklist.map(i => [i.text, i.done])).toEqual([['Rodar os testes', true]]);
});

test('marcar "depende de você" no painel do cartão salva de verdade', async ({ page, request }) => {
  const p = await projeto(request, 'Quadro Depende De Você');
  const cartao = await criarCartao(request, p.id, { title: 'Aprovar o logotipo', column: 'pending' });
  expect(cartao.needsOwner).toBe(false);
  await abrirQuadro(page, p.id);

  await page.locator(`[data-card-id="${cartao.id}"]`).click();
  const painel = page.getByRole('dialog', { name: 'Cartão: Aprovar o logotipo' });
  const caixa = painel.getByRole('checkbox', { name: 'Depende de você' });
  await expect(caixa).toHaveAttribute('aria-checked', 'false');

  await caixa.click();
  await expect(caixa).toHaveAttribute('aria-checked', 'true');
  await expect(painel.getByRole('status')).toContainText('Salvo');
  await expect(painel.locator('.quadro-painel-eventos')).toContainText('Marcou como dependente do dono');
  await expect.poll(async () => (await quadro(request, p.id)).cards.find(c => c.id === cartao.id)?.needsOwner).toBe(true);

  // A marca sobrevive a recarregar a página: vem do servidor, não da tela.
  await page.reload();
  await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
  await page.locator(`[data-card-id="${cartao.id}"]`).click();
  const painelDeNovo = page.getByRole('dialog', { name: 'Cartão: Aprovar o logotipo' });
  const caixaDeNovo = painelDeNovo.getByRole('checkbox', { name: 'Depende de você' });
  await expect(caixaDeNovo).toHaveAttribute('aria-checked', 'true');

  await caixaDeNovo.click();
  await expect(caixaDeNovo).toHaveAttribute('aria-checked', 'false');
  await expect(painelDeNovo.locator('.quadro-painel-eventos')).toContainText('Tirou a marca de dependente do dono');
  await expect.poll(async () => (await quadro(request, p.id)).cards.find(c => c.id === cartao.id)?.needsOwner).toBe(false);
});

test('cartão que uma IA leva a Completo comemora ao atualizar; a primeira carga não comemora', async ({ page, request }) => {
  const p = await projeto(request, 'Quadro Ao Vivo');
  const jaCompleto = await criarCartao(request, p.id, { title: 'Já estava pronto', column: 'done' });
  const cartao = await criarCartao(request, p.id, { title: 'Subir para produção', column: 'awaiting_deploy' });
  await abrirQuadro(page, p.id);
  await expect(page.locator(`[data-card-id="${jaCompleto.id}"]`)).toBeVisible();
  await expect(page.locator('[data-comemoracao]')).toHaveCount(0);

  await ok(request.post(`/api/projects/${p.id}/board/cards/${cartao.id}/move`, { headers: HEADERS, data: { actor: 'Gemini', expectedVersion: cartao.version, column: 'done' } }));
  await page.getByRole('button', { name: 'Atualizar quadro' }).click();
  await expect(page.locator(`[data-card-id="${cartao.id}"]`)).toHaveAttribute('data-comemoracao', 'completo');
  await expect(page.locator(`[data-card-id="${cartao.id}"]`)).toContainText('Gemini');
  await expect(page.locator(`[data-card-id="${jaCompleto.id}"]`)).not.toHaveAttribute('data-comemoracao', 'completo');
});

test('excluir de vez pede confirmação e some do servidor', async ({ page, request }) => {
  const p = await projeto(request, 'Quadro Excluir');
  const cartao = await criarCartao(request, p.id, { title: 'Ideia que não vai seguir', column: 'ideas' });
  await abrirQuadro(page, p.id);

  await page.locator(`[data-card-id="${cartao.id}"]`).click();
  const painel = page.getByRole('dialog', { name: 'Cartão: Ideia que não vai seguir' });
  await painel.getByRole('button', { name: 'Excluir cartão' }).click();
  await expect(painel.getByText('Excluir este cartão? O histórico continua guardado.')).toBeVisible();
  await painel.getByRole('alertdialog').getByRole('button', { name: 'Excluir cartão' }).click();

  await expect(page.locator(`[data-card-id="${cartao.id}"]`)).toHaveCount(0);
  expect((await quadro(request, p.id)).cards).toEqual([]);
});

test('em monitor grande (QHD), o quadro usa a largura e a altura da tela e mostra todas as colunas sem rolar', async ({ page, request }) => {
  const p = await projeto(request, 'Quadro Tela Grande');
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto(`/#project/${p.id}`);
  await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
  const trilho = page.locator('.quadro-trilho');
  await expect(trilho).toBeVisible();

  const medidas = await trilho.evaluate(el => {
    const caixa = el.getBoundingClientRect();
    const colunas = [...el.querySelectorAll('.quadro-coluna, .quadro-coluna-faixa')].map(c => c.getBoundingClientRect());
    return {
      rolaDeLado: el.scrollWidth > el.clientWidth + 1,
      largura: caixa.width,
      fundo: caixa.bottom,
      alturaDaTela: window.innerHeight,
      colunasVisiveis: colunas.filter(c => c.right <= caixa.right + 1 && c.left >= caixa.left - 1).length,
      totalDeColunas: colunas.length,
    };
  });
  expect(medidas.rolaDeLado, 'as 9 etapas cabem sem rolar para o lado').toBe(false);
  expect(medidas.colunasVisiveis).toBe(medidas.totalDeColunas);
  expect(medidas.totalDeColunas).toBe(9);
  expect(medidas.largura, 'o quadro não fica preso na faixa estreita do meio').toBeGreaterThan(1800);
  expect(medidas.alturaDaTela - medidas.fundo, 'as colunas descem até perto do fim da tela').toBeLessThan(80);
});
