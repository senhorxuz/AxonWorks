import { test, expect, type APIRequestContext } from '@playwright/test';

const HEADERS = { 'X-Workspace-Client': 'local' };
const TIPOS = ['specification', 'research', 'reference', 'note', 'artifact', 'specification', 'note', 'research'];

async function bibliotecaCheia(request: APIRequestContext, nome: string) {
  const projeto = await (await request.post('/api/projects', { headers: HEADERS, data: { name: nome, objective: 'Biblioteca.' } })).json();
  for (const [i, kind] of TIPOS.entries()) {
    const corpo = `# Documento ${i + 1}\n\nPrimeiro parágrafo do documento ${i + 1}, com **marcação** que não deve aparecer na prévia. ` + 'Texto de apoio. '.repeat(20 * (i + 1));
    const r = await request.post(`/api/projects/${projeto.id}/content`, { headers: HEADERS, data: {
      title: `Documento ${i + 1}`, kind, body: corpo, createdBy: 'Gemini', sourceKind: 'agent_report',
    } });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  return projeto as { id: string };
}

async function abrirBiblioteca(page: import('@playwright/test').Page, id: string) {
  await page.goto(`/#project/${id}`);
  await page.getByRole('tab', { name: 'Biblioteca', exact: true }).click();
  await expect(page.locator('.library-item').first()).toBeVisible();
}

test('Biblioteca sem documento aberto: grade que usa a largura, com prévia e ex-libris em cada cartão', async ({ page, request }) => {
  const projeto = await bibliotecaCheia(request, 'Biblioteca em grade');
  await page.setViewportSize({ width: 1440, height: 900 });
  await abrirBiblioteca(page, projeto.id);
  const cartoes = page.locator('.library-item');
  await expect(cartoes).toHaveCount(TIPOS.length);
  const topos = await cartoes.evaluateAll(els => els.slice(0, 3).map(el => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(topos).size, 'os três primeiros cartões na mesma linha').toBe(1);
  await expect(cartoes.first().locator('.library-item-previa')).toContainText('Primeiro parágrafo do documento');
  await expect(cartoes.first().locator('.library-item-previa')).not.toContainText('**');
  await expect(cartoes.first().locator('svg.ex-libris')).toBeVisible();
  await expect(page.locator('.library-document')).toHaveCount(0);
});

test('com documento aberto: lista e documento lado a lado, cada um rola sozinho; Fechar e Esc voltam à grade', async ({ page, request }) => {
  const projeto = await bibliotecaCheia(request, 'Biblioteca em leitura');
  await page.setViewportSize({ width: 1440, height: 800 });
  await abrirBiblioteca(page, projeto.id);
  await page.locator('.library-item', { hasText: 'Documento 8' }).click();
  const documento = page.locator('.library-document');
  await expect(documento.locator('h3')).toHaveText('Documento 8');
  await expect(documento.locator('svg.ex-libris')).toBeVisible();

  const lista = page.locator('.library-list');
  const a = (await lista.boundingBox())!;
  const b = (await documento.boundingBox())!;
  expect(b.x, 'documento ao lado da lista').toBeGreaterThan(a.x + a.width - 1);
  for (const [nome, el] of [['lista', lista], ['documento', documento]] as const) {
    const medida = await el.evaluate(e => ({ overflow: getComputedStyle(e).overflowY, altura: e.getBoundingClientRect().height, janela: innerHeight }));
    expect(medida.overflow, `${nome} rola sozinho`).toBe('auto');
    expect(medida.altura, `${nome} cabe na janela`).toBeLessThanOrEqual(medida.janela);
  }

  await page.getByRole('button', { name: 'Fechar documento' }).click();
  await expect(documento).toHaveCount(0);
  await expect(page.locator('.library-layout.em-grade')).toBeVisible();

  await page.locator('.library-item').first().click();
  await expect(page.locator('.library-document')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.library-document')).toHaveCount(0);
});

test('o hero da Biblioteca: título, busca e Novo conteúdo; o que importa; o livro com o ex-libris; o último guardado abre direto', async ({ page, request }) => {
  const projeto = await bibliotecaCheia(request, 'Biblioteca com hero');
  await abrirBiblioteca(page, projeto.id);
  const heroi = page.locator('.heroi');
  await expect(heroi).toBeVisible();
  await expect(heroi.getByRole('heading', { name: 'Biblioteca', exact: true })).toBeVisible();
  await expect(heroi.getByLabel('Buscar na revisão vigente')).toBeVisible();
  await expect(heroi.getByRole('button', { name: 'Novo conteúdo', exact: true })).toBeVisible();

  // O que importa: quantos, de quais tipos.
  await expect(heroi.locator('.heroi-resumo strong')).toHaveText(`${TIPOS.length} documentos`);
  await expect(heroi.locator('.heroi-resumo')).toContainText('Especificação 2');

  // O livro: páginas, texto em linhas, a fita e o ex-libris do projeto na página.
  const livro = heroi.locator('svg.heroi-livro');
  await expect(livro).toBeVisible();
  expect(await livro.locator('.heroi-livro-linha').count()).toBeGreaterThan(15);
  await expect(livro.locator('.heroi-livro-guilloche')).toHaveCount(3);
  await expect(livro.locator('.heroi-livro-fita')).toHaveCount(1);

  // O último guardado abre direto o documento mais recente.
  const ultimo = heroi.locator('.heroi-ultimo');
  await expect(ultimo).toContainText('Último guardado');
  await expect(ultimo).toContainText('Documento 8');
  await ultimo.click();
  await expect(page.locator('.library-document h3')).toHaveText('Documento 8');
});
