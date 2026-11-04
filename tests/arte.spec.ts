import { test, expect, type APIRequestContext } from '@playwright/test';

const HEADERS = { 'X-Workspace-Client': 'local' };

async function projetoComHistoria(request: APIRequestContext, nome: string) {
  const projeto = await (await request.post('/api/projects', { headers: HEADERS, data: { name: nome, objective: 'Arte com dados reais.' } })).json();
  const ok = async (r: Promise<import('@playwright/test').APIResponse>) => expect((await r).ok()).toBeTruthy();
  await ok(request.post(`/api/projects/${projeto.id}/checkpoints`, { headers: HEADERS, data: {
    agent: 'Gemini', expectedRevision: 0, idempotencyKey: `arte-${nome}`, summary: 'Feito.', humanSummary: 'O cadastro ficou pronto.', nextStep: 'Seguir.',
  } }));
  for (const [column, title] of [['done', 'Página de login'], ['in_progress', 'Checkout'], ['ideas', 'Cupom']]) {
    await ok(request.post(`/api/projects/${projeto.id}/board/cards`, { headers: HEADERS, data: { actor: 'Gemini', title, column } }));
  }
  return projeto as { id: string };
}

test('Onde paramos mostra o fio do projeto para ser lido: um nó por dia com a contagem, e um fio solto com nome por grupo de pendência', async ({ page, request }) => {
  const projeto = await projetoComHistoria(request, 'Fio com história');
  await page.goto(`/#project/${projeto.id}`);
  await page.getByRole('tab', { name: 'Onde paramos', exact: true }).click();
  const palco = page.locator('.fio-palco');
  await expect(palco).toBeVisible();
  // Registro e cartão concluído no mesmo dia: um nó só, com 2.
  await expect(palco.locator('.fio-legenda-resumo')).toHaveText('2 coisas feitas em 1 dia');
  await expect(palco.locator('.fio-heroi .fio-no')).toHaveCount(1);
  await expect(palco.locator('.fio-no-ultimo')).toHaveCount(1);
  await expect(palco.locator('.fio-contagem')).toHaveText(['2']);
  await expect(palco.locator('.fio-regua-agora')).toHaveText(/^onde paramos · \d{2} \w{3}$/);
  // Um fio solto por grupo que tem pendência, com o nome escrito na ponta.
  await expect(palco.locator('.fio-ponta')).toHaveCount(2);
  await expect(palco.locator('.fio-ponta-rotulo')).toHaveText(['1 Em andamento', '1 Ideias']);
  await expect(palco.locator('svg[role="img"]')).toHaveAttribute('aria-label', /2 coisas feitas em 1 dia\. Pendências: 1 em andamento, 1 ideias\./);

  // A dica do dia lista o que foi feito naquele dia.
  await page.waitForTimeout(1200);
  await palco.locator('.fio-no').first().hover();
  const dica = palco.locator('.fio-dica');
  await expect(dica).toBeVisible();
  await expect(dica.locator('.fio-dica-tipo')).toContainText('2 coisas feitas');
  await expect(dica.locator('li')).toHaveCount(2);
  await expect(dica).toContainText('O cadastro ficou pronto.');
  await expect(dica).toContainText('Página de login');
});

test('a lista de projetos mostra a miniatura do fio de cada projeto e o Tear vivo com todos eles', async ({ page, request }) => {
  await projetoComHistoria(request, 'Tear um');
  await page.goto('/#projects');
  const linhas = page.locator('.library-project');
  await expect(linhas.first()).toBeVisible();
  expect(await page.locator('.library-project .fio-mini').count()).toBe(await linhas.count());

  const tear = page.locator('.tear');
  await expect(tear).toBeVisible();
  await expect(tear.locator('.tear-resumo')).toHaveText(/^\d+ projetos?( · os 6 mais recentes)?$/);
  await expect(tear).toHaveAttribute('aria-label', /^Sua memória: \d+ projetos?.*\. O mais recente, aceso, é Tear um, com atividade (agora mesmo|há 1 min)\.$/);
  // Um trilho por projeto (no máximo seis), o mais recente no alto e aceso, com o nome legível ao lado.
  const trilhos = tear.locator('.tear-projeto');
  const quantos = await trilhos.count();
  expect(quantos).toBeGreaterThanOrEqual(1);
  expect(quantos).toBeLessThanOrEqual(6);
  const vivo = trilhos.first();
  await expect(vivo).toHaveClass(/tear-projeto-vivo/);
  await expect(vivo.locator('.tear-nome')).toHaveText('Tear um');
  // O "quanto foi feito" vem da carta do projeto (o registro e o cartão concluído): dado real, nada inventado.
  await expect(vivo.locator('.tear-quando')).toHaveText(/^(agora mesmo|há 1 min) · 2 coisas feitas$/);
  const tela = page.locator('canvas.tear-viva');
  const fixa = page.locator('canvas.tear-fixa');
  await expect.poll(() => tintaNaTela(fixa), 'o Tear pinta a trama').toBeGreaterThan(500);
  const antes = await imagem(tela);
  await page.waitForTimeout(900);
  expect(await imagem(tela), 'o Tear se move com o tempo').not.toBe(antes);
});

/** A imagem pintada no canvas, para comparar dois instantes. */
const imagem = (tela: import('@playwright/test').Locator) => tela.evaluate(el => (el as HTMLCanvasElement).toDataURL());
/** Quantos pixels têm tinta: prova que a trama foi desenhada. */
const tintaNaTela = (tela: import('@playwright/test').Locator) => tela.evaluate(el => {
  const c = el as HTMLCanvasElement;
  const dados = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let pintados = 0;
  for (let i = 3; i < dados.length; i += 4) if (dados[i]! > 0) pintados++;
  return pintados;
});

test('o Tear respira quando você chega e descansa depois de 20 segundos; o mouse por cima acorda de novo', async ({ page, request }) => {
  await projetoComHistoria(request, 'Tear que descansa');
  await page.clock.install();
  await page.goto('/#projects');
  const tela = page.locator('canvas.tear-viva');
  const fixa = page.locator('canvas.tear-fixa');
  await expect.poll(() => tintaNaTela(fixa)).toBeGreaterThan(500);
  // Os dados de cada projeto chegam antes: a chegada deles redesenha o Tear, e aqui o que se mede é a animação.
  await expect(page.locator('.tear-quando', { hasText: 'lendo…' })).toHaveCount(0);
  await page.clock.runFor(25_000);
  const descansando = await imagem(tela);
  await page.clock.runFor(3_000);
  expect(await imagem(tela), 'depois de 20 segundos o Tear para').toBe(descansando);

  const caixa = (await tela.boundingBox())!;
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  await page.mouse.move(caixa.x + caixa.width / 2 + 10, caixa.y + caixa.height / 2);
  await page.clock.runFor(1_500);
  await expect.poll(() => imagem(tela)).not.toBe(descansando);
});

test('com movimento reduzido, o fio aparece pronto e o Tear fica parado', async ({ page, request }) => {
  const projeto = await projetoComHistoria(request, 'Sem movimento');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#projects');
  const tela = page.locator('canvas.tear-viva');
  const fixa = page.locator('canvas.tear-fixa');
  await expect.poll(() => tintaNaTela(fixa)).toBeGreaterThan(500);
  await expect(page.locator('.tear-quando', { hasText: 'lendo…' })).toHaveCount(0);
  const antes = await imagem(tela);
  await page.waitForTimeout(900);
  expect(await imagem(tela)).toBe(antes);

  await page.goto(`/#project/${projeto.id}`);
  await page.getByRole('tab', { name: 'Onde paramos', exact: true }).click();
  const fibra = page.locator('.fio-heroi .fio-fibra').first();
  await expect(fibra).toBeVisible();
  expect(await fibra.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  expect(await page.locator('.fio-pulso').evaluate(el => getComputedStyle(el).display)).toBe('none');
});

test('botões: a luz acompanha o mouse e o aperto solta uma onda no ponto exato', async ({ page }) => {
  await page.goto('/#projects');
  const botao = page.getByRole('button', { name: 'Importar projeto' });
  await expect(botao).toBeVisible();
  const caixa = (await botao.boundingBox())!;
  await page.mouse.move(caixa.x + 20, caixa.y + 10);
  await page.mouse.move(caixa.x + 24, caixa.y + 12);
  // A caixa do botão pode começar em meio pixel: aceita a diferença do arredondamento.
  const variavel = (nome: string) => botao.evaluate((el, n) => parseFloat((el as HTMLElement).style.getPropertyValue(n)), nome);
  await expect.poll(() => variavel('--mx')).toBeGreaterThanOrEqual(23);
  expect(Math.abs(await variavel('--mx') - 24)).toBeLessThanOrEqual(1);
  expect(Math.abs(await variavel('--my') - 12)).toBeLessThanOrEqual(1);

  await page.mouse.down();
  await expect(botao).toHaveAttribute('data-toque', '');
  expect(Math.abs(await variavel('--tx') - 24)).toBeLessThanOrEqual(1);
  // Solta fora do botão: não abre nada, mas a onda termina e a marca sai sozinha.
  await page.mouse.move(caixa.x - 200, caixa.y + 300);
  await page.mouse.up();
  await expect(botao).not.toHaveAttribute('data-toque', '');
});
