import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { WorkspaceStore } from '../server/store';
import type { CompactionSnapshotInput } from '../shared/types';
import { medirLegibilidade } from './apoio/legibilidade';

/**
 * Seção "Salvamentos de compactação" da tela "Onde paramos" (D5).
 *
 * O salvamento só nasce pelo MCP (`save_compaction_snapshot`), que não tem rota HTTP. Por isso a suíte abre
 * o banco da própria suíte (`AXON_E2E_DB_PATH`) com o mesmo `WorkspaceStore` do servidor e grava pelo
 * caminho de verdade (validação, revisão, idempotência). O servidor e a tela continuam reais.
 */

const HEADERS = { 'X-Workspace-Client': 'local' };

function nomeUnico(base: string) {
  return `${base} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function criarProjeto(request: APIRequestContext, nome: string) {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name: nome, objective: 'Vender cursos pela internet.' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; name: string };
}

/** Grava os salvamentos em sequência, cada um na revisão seguinte. */
function salvar(projectId: string, salvamentos: Array<Partial<CompactionSnapshotInput>>) {
  const dbPath = process.env.AXON_E2E_DB_PATH;
  expect(dbPath, 'AXON_E2E_DB_PATH deve estar definido').toBeTruthy();
  const store = new WorkspaceStore(dbPath!);
  try {
    for (const [indice, over] of salvamentos.entries()) {
      store.saveCompactionSnapshot(projectId, {
        expectedRevision: store.getProject(projectId).project.revision,
        idempotencyKey: `e2e-salvar-${indice}`,
        agent: 'Claude',
        summary: 'Estado completo.',
        humanSummary: 'Frase para o dono.',
        nextStep: 'Seguir.',
        pedidosDoDono: [],
        pendencias: [],
        ...over,
      });
    }
  } finally {
    store.close();
  }
}

async function abrirCarta(page: Page, projeto: { id: string; name: string }) {
  await page.goto(`/#project/${projeto.id}`);
  await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toBeVisible();
  const aba = page.getByRole('tab', { name: 'Onde paramos' });
  if ((await aba.getAttribute('aria-selected')) !== 'true') await aba.click();
  await expect(page.getByRole('heading', { name: 'Onde paramos', level: 2 })).toBeVisible();
}

function secao(page: Page) {
  return page.getByRole('region', { name: 'Salvamentos de compactação' });
}

test('salvamentos aparecem recolhidos, o mais novo primeiro; aberto, mostra a frase do dono e guarda o técnico em "Detalhes técnicos"', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto salvamento'));
  salvar(projeto.id, [
    { humanSummary: 'O login novo ficou pronto.', summary: 'Login com sessão no servidor.', nextStep: 'Começar o cadastro.' },
    {
      humanSummary: 'O cadastro está pela metade.',
      summary: 'Cadastro com validação de e-mail; falta a confirmação.',
      nextStep: 'Mandar o e-mail de confirmação.',
      pedidosDoDono: ['Faz o cadastro', 'Confirma o e-mail das pessoas'],
      pendencias: ['E-mail de confirmação'],
      arquivosMexidos: ['src/cadastro.ts'],
    },
  ]);

  await abrirCarta(page, projeto);

  await expect(page.getByRole('heading', { name: 'Salvamentos de compactação', level: 3 })).toBeVisible();
  const resumos = secao(page).locator('details.carta-salvamento > summary');
  await expect(resumos).toHaveCount(2);
  await expect(resumos.nth(0)).toHaveText(/^\d{2}\/\d{2} às \d{2}:\d{2} · O cadastro está pela metade\.$/);
  await expect(resumos.nth(1)).toContainText('O login novo ficou pronto.');
  await expect(page.getByText('Cadastro com validação de e-mail; falta a confirmação.')).toBeHidden();

  await resumos.nth(0).click();

  const aberto = secao(page).locator('details.carta-salvamento').nth(0);
  // O texto principal é a frase para o dono; o resumo técnico e os arquivos ficam recolhidos.
  await expect(aberto.locator('.carta-salvamento-frase')).toHaveText('O cadastro está pela metade.');
  await expect(aberto.getByText('Cadastro com validação de e-mail; falta a confirmação.')).toBeHidden();
  await expect(aberto.getByText('src/cadastro.ts')).toBeHidden();
  await expect(aberto.getByRole('heading', { name: 'Pedidos do dono', level: 4 })).toBeVisible();
  await expect(aberto.getByRole('listitem')).toHaveText(['Faz o cadastro', 'Confirma o e-mail das pessoas', 'E-mail de confirmação']);
  await expect(aberto.getByRole('heading', { name: 'Pendências', level: 4 })).toBeVisible();
  await expect(aberto.getByRole('heading', { name: 'Perguntas abertas' })).toHaveCount(0);
  await expect(aberto.getByText('Mandar o e-mail de confirmação.')).toBeVisible();

  const tecnicos = aberto.locator('details.carta-salvamento-tecnico');
  await expect(tecnicos.locator('> summary')).toHaveText('Detalhes técnicos');
  await tecnicos.locator('> summary').click();
  await expect(tecnicos.getByText('Cadastro com validação de e-mail; falta a confirmação.')).toBeVisible();
  await expect(tecnicos.getByRole('heading', { name: 'Arquivos mexidos', level: 5 })).toBeVisible();
  await expect(tecnicos.getByRole('listitem')).toHaveText(['src/cadastro.ts']);
  // O outro continua recolhido.
  await expect(page.getByText('Login com sessão no servidor.')).toBeHidden();
});

test('sem arquivos mexidos, os detalhes técnicos só trazem o estado', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto sem arquivos'));
  salvar(projeto.id, [{ humanSummary: 'Sem arquivos.', summary: 'Estado sem arquivos.' }]);

  await abrirCarta(page, projeto);
  await secao(page).locator('details.carta-salvamento > summary').click();
  const tecnicos = secao(page).locator('details.carta-salvamento-tecnico');
  await tecnicos.locator('> summary').click();
  await expect(tecnicos.getByText('Estado sem arquivos.')).toBeVisible();
  await expect(tecnicos.getByRole('heading', { name: 'Arquivos mexidos' })).toHaveCount(0);
});

test('só os 5 mais recentes aparecem', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto muitos salvamentos'));
  salvar(projeto.id, Array.from({ length: 7 }, (_, i) => ({ humanSummary: `Salvamento número ${i + 1}.` })));

  await abrirCarta(page, projeto);

  const resumos = secao(page).locator('details.carta-salvamento > summary');
  await expect(resumos).toHaveCount(5);
  await expect(resumos.nth(0)).toContainText('Salvamento número 7.');
  await expect(resumos.nth(4)).toContainText('Salvamento número 3.');
});

test('sem salvamento, a seção não aparece', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto sem salvamento'));

  await abrirCarta(page, projeto);

  await expect(page.getByRole('heading', { name: 'Salvamentos de compactação' })).toHaveCount(0);
});

test('pelo teclado: o salvamento e os detalhes técnicos abrem com Enter e o estado longo recebe foco para rolar', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto teclado'));
  salvar(projeto.id, [{ humanSummary: 'Pelo teclado.', summary: 'Linha do estado. '.repeat(200) }]);

  await abrirCarta(page, projeto);
  const resumo = secao(page).locator('details.carta-salvamento > summary');
  await resumo.focus();
  await page.keyboard.press('Enter');
  await expect(secao(page).locator('details.carta-salvamento')).toHaveAttribute('open', '');
  await page.keyboard.press('Tab');
  await expect(secao(page).locator('details.carta-salvamento-tecnico > summary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(secao(page).locator('details.carta-salvamento-tecnico')).toHaveAttribute('open', '');
  await page.keyboard.press('Tab');
  await expect(secao(page).getByRole('region', { name: /^Estado salvo em / })).toBeFocused();
});

test('legível no computador e no celular, sem passar da largura da tela', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto legível salvamento'));
  salvar(projeto.id, [
    {
      humanSummary: 'Uma frase longa para o dono, escrita para caber em duas linhas no celular sem cortar nada no meio.',
      summary: 'Estado longo. '.repeat(80),
      pedidosDoDono: ['Um pedido muito comprido do dono com palavras de verdade para quebrar a linha no celular'],
      pendencias: ['Pendência'],
      perguntasAbertas: ['Pergunta aberta?'],
      arquivosMexidos: ['src/um/caminho/de/arquivo/bem/comprido/que/nao/tem/espaco/nenhum/para/quebrar.ts'],
    },
  ]);

  await abrirCarta(page, projeto);
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
  await page.waitForTimeout(300);
  const medida = await page.evaluate(medirLegibilidade);
  expect(medida.falhasTamanho, 'textos abaixo do tamanho mínimo').toEqual([]);
  expect(medida.falhasContraste, 'textos com contraste insuficiente').toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const larguras = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(larguras.pagina).toBeLessThanOrEqual(larguras.tela);
  const caixa = await secao(page).locator('details.carta-salvamento').boundingBox();
  expect(caixa).not.toBeNull();
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(390);
});
