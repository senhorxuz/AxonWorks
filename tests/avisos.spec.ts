import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { WorkspaceStore } from '../server/store';
import { medirLegibilidade } from './apoio/legibilidade';

/**
 * Avisos da tela "Onde paramos" (lote 2, D2: diretriz velha).
 *
 * Uma diretriz com 14 dias ou mais não nasce em tempo real: a suíte abre o banco da própria suíte
 * (`AXON_E2E_DB_PATH`) com o mesmo `WorkspaceStore` do servidor e um relógio de um mês atrás. Isso é
 * arranjo de dados; o servidor e a tela continuam reais.
 */

const HEADERS = { 'X-Workspace-Client': 'local' };
const DIA = 86_400_000;

function nomeUnico(base: string) {
  return `${base} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/** Projeto criado há 30 dias (a diretriz nasce com ele) e com `registros` registros depois dela. */
function projetoComDiretrizVelha(nome: string, registros: number): { id: string; name: string } {
  const dbPath = process.env.AXON_E2E_DB_PATH;
  expect(dbPath, 'AXON_E2E_DB_PATH deve estar definido').toBeTruthy();
  let instante = Date.now() - 30 * DIA;
  const store = new WorkspaceStore(dbPath!, { now: () => new Date((instante += 60_000)) });
  try {
    const projeto = store.createProject({ name: nome, objective: 'Vender cursos pela internet.' });
    for (let i = 0; i < registros; i++) {
      store.saveCheckpoint(projeto.id, {
        expectedRevision: store.getProject(projeto.id).project.revision,
        idempotencyKey: `e2e-aviso-${i}`,
        agent: 'Claude',
        summary: `Registro ${i}.`,
        nextStep: 'Seguir.',
      });
    }
    return { id: projeto.id, name: projeto.name };
  } finally {
    store.close();
  }
}

async function criarProjeto(request: APIRequestContext, nome: string) {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name: nome, objective: 'Vender cursos pela internet.' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; name: string };
}

async function abrirCarta(page: Page, projeto: { id: string; name: string }) {
  await page.goto(`/#project/${projeto.id}`);
  await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toBeVisible();
  const aba = page.getByRole('tab', { name: 'Onde paramos' });
  if ((await aba.getAttribute('aria-selected')) !== 'true') await aba.click();
  await expect(page.getByRole('heading', { name: 'Onde paramos', level: 2 })).toBeVisible();
}

const secao = (page: Page) => page.getByRole('region', { name: 'Avisos' });

test('diretriz velha com 5 registros depois: o aviso aparece antes de "Em uma frase", na frase do dono, sem nome de ferramenta', async ({ page }) => {
  const projeto = projetoComDiretrizVelha(nomeUnico('Projeto diretriz velha'), 5);

  await abrirCarta(page, projeto);

  await expect(page.getByRole('heading', { name: 'Avisos', level: 3 })).toBeVisible();
  const itens = secao(page).getByRole('listitem');
  await expect(itens).toHaveCount(1);
  await expect(itens.nth(0)).toHaveText(
    /^A diretriz deste projeto não muda desde \d{2}\/\d{2}\/\d{4}, e desde então houve 5 registros\. Se o projeto mudou, o Claude pode propor a atualização, e você aprova aqui na Axon\.$/,
  );
  const avisos = await secao(page).boundingBox();
  const frase = await page.getByRole('heading', { name: 'Em uma frase', level: 3 }).boundingBox();
  expect(avisos!.y).toBeLessThan(frase!.y);
});

test('sem aviso (projeto novo, ou diretriz velha com poucos registros), a seção não aparece', async ({ page, request }) => {
  await abrirCarta(page, await criarProjeto(request, nomeUnico('Projeto sem aviso')));
  await expect(page.getByRole('heading', { name: 'Avisos' })).toHaveCount(0);

  await abrirCarta(page, projetoComDiretrizVelha(nomeUnico('Projeto poucos registros'), 4));
  await expect(page.getByRole('heading', { name: 'Avisos' })).toHaveCount(0);
});

test('o aviso é legível no computador e no celular, sem passar da largura da tela', async ({ page }) => {
  const projeto = projetoComDiretrizVelha(nomeUnico('Projeto aviso legível'), 6);

  await abrirCarta(page, projeto);
  await expect(secao(page)).toBeVisible();
  const medida = await page.evaluate(medirLegibilidade);
  expect(medida.falhasTamanho, 'textos abaixo do tamanho mínimo').toEqual([]);
  expect(medida.falhasContraste, 'textos com contraste insuficiente').toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const larguras = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(larguras.pagina).toBeLessThanOrEqual(larguras.tela);
  const caixa = await secao(page).getByRole('listitem').nth(0).boundingBox();
  expect(caixa).not.toBeNull();
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(390);
  const noCelular = await page.evaluate(medirLegibilidade);
  expect(noCelular.falhasContraste, 'contraste no celular').toEqual([]);
});
