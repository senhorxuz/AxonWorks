import { test, expect, type Page } from '@playwright/test';

/**
 * Batida da tela (src/batida.ts ligada em src/main.tsx), no navegador de verdade e no build de produção:
 * enquanto a aba está à vista, a página pede /api/health a cada 5 minutos para o servidor que se desliga sozinho
 * não caia com alguém olhando. Aba escondida não bate; ao voltar, bate na hora.
 *
 * O relógio é o do Playwright (`page.clock`): cinco minutos passam em milissegundos, sem esperar.
 */

async function mudarVisibilidade(page: Page, estado: 'visible' | 'hidden') {
  await page.evaluate(valor => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => valor });
    document.dispatchEvent(new Event('visibilitychange'));
  }, estado);
}

test('a tela avisa o servidor a cada 5 minutos enquanto está à vista e descansa quando a aba é escondida', async ({ page }) => {
  await page.clock.install();
  const pedidos: string[] = [];
  page.on('request', pedido => {
    if (new URL(pedido.url()).pathname === '/api/health') pedidos.push(pedido.url());
  });

  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.waitForLoadState('networkidle');
  const aoCarregar = pedidos.length;
  expect(aoCarregar, 'a página já pergunta o modo ao carregar').toBeGreaterThanOrEqual(1);

  // À vista: uma batida a cada 5 minutos.
  await page.clock.runFor('04:50');
  await page.waitForTimeout(300);
  expect(pedidos.length, 'antes dos 5 minutos não bate').toBe(aoCarregar);
  await page.clock.runFor('00:10');
  await expect.poll(() => pedidos.length).toBe(aoCarregar + 1);
  await page.clock.runFor('05:00');
  await expect.poll(() => pedidos.length).toBe(aoCarregar + 2);

  // Escondida: nada, por mais tempo que passe.
  await mudarVisibilidade(page, 'hidden');
  await page.clock.runFor('15:00');
  await page.waitForTimeout(300);
  expect(pedidos.length, 'aba escondida não bate').toBe(aoCarregar + 2);

  // De volta: bate na hora e retoma o ritmo.
  await mudarVisibilidade(page, 'visible');
  await expect.poll(() => pedidos.length).toBe(aoCarregar + 3);
  await page.clock.runFor('05:00');
  await expect.poll(() => pedidos.length).toBe(aoCarregar + 4);
});

/**
 * A faixa de aviso: o servidor que o atalho liga se desliga sozinho depois de 30 minutos sem uso. Se a aba ficou
 * escondida esse tempo todo, ao voltar a batida não acha ninguém, e a tela diz isso em vez de ficar parada sem explicar.
 * O servidor "desliga" aqui com `page.route` (a batida não encontra ninguém); a tela e o servidor do teste seguem de pé.
 */
const TEXTO_DA_FAIXA = 'A Axon desligou por falta de uso. Clique no atalho Axon para ligar de novo.';

async function esperarTelaCarregada(page: Page) {
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.waitForLoadState('networkidle');
}

test('aba escondida que volta com o servidor desligado mostra a faixa, e a faixa some quando uma batida seguinte dá certo', async ({ page }) => {
  await esperarTelaCarregada(page);
  const faixa = page.getByText(TEXTO_DA_FAIXA);
  await expect(faixa, 'tela recém-aberta, servidor de pé: sem faixa').toHaveCount(0);

  // O servidor se desliga enquanto a aba está escondida.
  await page.route('**/api/health', rota => rota.abort('connectionrefused'));
  await mudarVisibilidade(page, 'hidden');
  await mudarVisibilidade(page, 'visible');
  await expect(faixa).toBeVisible();
  await expect(page.getByRole('status')).toContainText(TEXTO_DA_FAIXA);

  // Faixa fixa: continua no topo da janela mesmo com a página rolada.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const caixa = await faixa.locator('xpath=..').boundingBox();
  expect(caixa?.y, 'a faixa fica colada no topo').toBeLessThanOrEqual(1);

  // O dono clica no atalho: o servidor volta. A próxima vez que a aba aparece, a batida dá certo e a faixa some.
  await page.unroute('**/api/health');
  await mudarVisibilidade(page, 'hidden');
  await mudarVisibilidade(page, 'visible');
  await expect(faixa).toHaveCount(0);
});

test('a batida periódica que falha com a aba à vista também mostra a faixa (computador que acordou sem o servidor)', async ({ page }) => {
  await page.clock.install();
  await esperarTelaCarregada(page);
  const faixa = page.getByText(TEXTO_DA_FAIXA);
  await expect(faixa).toHaveCount(0);

  await page.route('**/api/health', rota => rota.abort('connectionrefused'));
  await page.clock.runFor('05:10');
  await expect(faixa).toBeVisible();

  await page.unroute('**/api/health');
  await page.clock.runFor('05:00');
  await expect(faixa).toHaveCount(0);
});

test('a faixa cabe e se lê num celular: sem rolagem lateral, texto inteiro à vista e contraste de 4,5 para 1 ou mais', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await esperarTelaCarregada(page);
  await page.route('**/api/health', rota => rota.abort('connectionrefused'));
  await mudarVisibilidade(page, 'hidden');
  await mudarVisibilidade(page, 'visible');
  const faixa = page.getByText(TEXTO_DA_FAIXA);
  await expect(faixa).toBeVisible();

  const medida = await page.evaluate(() => {
    const texto = Array.from(document.querySelectorAll('[role="status"] *')).find(el => el.textContent?.includes('A Axon desligou'));
    const caixa = texto!.closest('[role="status"] > *')!;
    const estilo = getComputedStyle(caixa);
    const rect = caixa.getBoundingClientRect();
    const canal = (cor: string) => cor.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luz = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const claro = Math.max(luz(canal(estilo.color)), luz(canal(estilo.backgroundColor)));
    const escuro = Math.min(luz(canal(estilo.color)), luz(canal(estilo.backgroundColor)));
    return {
      rolagemLateral: document.documentElement.scrollWidth > window.innerWidth,
      esquerda: rect.left, direita: rect.right, largura: window.innerWidth,
      tamanhoDaFonte: parseFloat(estilo.fontSize),
      contraste: (claro + 0.05) / (escuro + 0.05),
    };
  });
  expect(medida.rolagemLateral).toBe(false);
  expect(medida.esquerda).toBeGreaterThanOrEqual(0);
  expect(medida.direita).toBeLessThanOrEqual(medida.largura);
  expect(medida.tamanhoDaFonte).toBeGreaterThanOrEqual(13);
  expect(medida.contraste).toBeGreaterThanOrEqual(4.5);
});
