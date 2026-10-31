import { test, expect, type Page } from '@playwright/test';
import { WorkspaceStore } from '../server/store';
import { AGENTE_AUTOMATICO } from '../shared/carta';

/**
 * O dono apaga trecho ou registro inteiro pela tela (27/10/2026), e descarta o rascunho automático.
 * O arranjo grava direto no banco da suíte (`AXON_E2E_DB_PATH`) com o mesmo `WorkspaceStore` do servidor
 * (o salvamento de compactação não tem rota HTTP); servidor e tela continuam reais.
 */

const SEGREDO = 'chave-que-vazou-987';

function nomeUnico(base: string) {
  return `${base} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function arranjar(nome: string, comRascunho: boolean) {
  const dbPath = process.env.AXON_E2E_DB_PATH;
  expect(dbPath, 'AXON_E2E_DB_PATH deve estar definido').toBeTruthy();
  let instante = Date.now() - 60 * 60_000;
  const store = new WorkspaceStore(dbPath!, { now: () => new Date((instante += 60_000)) });
  try {
    const projeto = store.createProject({ name: nome, objective: 'Testar o apagamento pela tela.' });
    const comum = store.saveCheckpoint(projeto.id, {
      expectedRevision: 0,
      idempotencyKey: 'e2e-apagar-1',
      agent: 'Claude',
      summary: `O login usa ${SEGREDO} e ${SEGREDO}.`,
      nextStep: 'Trocar a chave.',
      decisions: [`Guardar ${SEGREDO} no cofre`],
    });
    store.saveCompactionSnapshot(projeto.id, {
      expectedRevision: 1,
      idempotencyKey: 'e2e-apagar-2',
      agent: 'Claude',
      summary: 'Estado da sessão antes de compactar.',
      humanSummary: 'Salvamento com coisa que não devia.',
      nextStep: 'Revisar o cadastro.',
      pedidosDoDono: ['Pedido particular do dono'],
      pendencias: ['Pendência particular'],
    });
    if (comRascunho) {
      store.saveWorkDraft(projeto.id, { agent: AGENTE_AUTOMATICO, expectedVersion: 0, summary: 'Rascunho anotado sozinho.', nextAction: 'Ver acima.' });
    }
    return { id: projeto.id, name: projeto.name, comumId: comum.id };
  } finally {
    store.close();
  }
}

async function abrirProjeto(page: Page, projeto: { id: string; name: string }) {
  await page.goto(`/#project/${projeto.id}`);
  await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toBeVisible();
}

test('apaga um trecho na aba Checkpoints: mostra quantas vezes aparece antes de apagar de vez', async ({ page }) => {
  const projeto = arranjar(nomeUnico('Projeto apagar trecho'), false);
  await abrirProjeto(page, projeto);
  await page.getByRole('tab', { name: /^Checkpoints/ }).click();
  const cartao = page.locator('article.checkpoint-card').filter({ hasText: 'O login usa' });
  await expect(cartao).toContainText(SEGREDO);
  await cartao.getByRole('button', { name: 'Apagar trecho', exact: true }).click();
  const caixa = page.getByRole('dialog', { name: 'Apagar trecho', exact: true });
  await expect(caixa.getByLabel('Texto exato que você quer apagar')).toBeFocused();

  await caixa.getByRole('button', { name: 'Conferir quantas vezes aparece' }).click();
  await expect(caixa.getByRole('alert')).toHaveText('Cole o trecho que você quer apagar.');

  await caixa.getByLabel('Texto exato que você quer apagar').fill('não está aqui');
  await caixa.getByRole('button', { name: 'Conferir quantas vezes aparece' }).click();
  await expect(caixa.getByRole('status')).toContainText('não aparece neste registro');
  await expect(caixa.getByRole('button', { name: 'Apagar de vez' })).toHaveCount(0);

  await caixa.getByLabel('Texto exato que você quer apagar').fill(SEGREDO);
  await caixa.getByRole('button', { name: 'Conferir quantas vezes aparece' }).click();
  await expect(caixa.getByRole('status')).toHaveText('Esse trecho aparece 3 vezes neste registro.');
  await expect(caixa).toContainText('Não dá para desfazer');
  await caixa.getByRole('button', { name: 'Apagar de vez' }).click();
  await expect(caixa).not.toBeVisible();

  await expect(cartao).not.toContainText(SEGREDO);
  await expect(cartao).toContainText('[trecho apagado pelo dono em');
});

test('apaga o registro inteiro de um salvamento em "Onde paramos" só depois de digitar APAGAR (celular)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const projeto = arranjar(nomeUnico('Projeto apagar registro'), false);
  await abrirProjeto(page, projeto);
  const aba = page.getByRole('tab', { name: 'Onde paramos' });
  if ((await aba.getAttribute('aria-selected')) !== 'true') await aba.click();
  const salvamento = page.locator('details.carta-salvamento').first();
  await salvamento.locator(':scope > summary').click();
  await expect(salvamento).toContainText('Pedido particular do dono');
  await salvamento.getByRole('button', { name: 'Apagar registro inteiro' }).click();

  const caixa = page.getByRole('dialog', { name: 'Apagar registro inteiro', exact: true });
  const confirmar = caixa.getByRole('button', { name: 'Apagar registro inteiro' });
  await expect(confirmar).toBeDisabled();
  await caixa.getByLabel('Para confirmar, digite APAGAR').fill('apagar');
  await expect(confirmar).toBeDisabled();
  await caixa.getByLabel('Para confirmar, digite APAGAR').fill('APAGAR');
  await confirmar.click();
  await expect(caixa).not.toBeVisible();

  await expect(page.getByText('Pedido particular do dono')).toHaveCount(0);
  await expect(page.locator('details.carta-salvamento').first()).toContainText('[registro apagado pelo dono em');
  const larguraDaPagina = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(larguraDaPagina).toBeLessThanOrEqual(390);
});

test('descarta o rascunho automático visível em "Onde paramos"', async ({ page }) => {
  const projeto = arranjar(nomeUnico('Projeto rascunho'), true);
  await abrirProjeto(page, projeto);
  const aba = page.getByRole('tab', { name: 'Onde paramos' });
  if ((await aba.getAttribute('aria-selected')) !== 'true') await aba.click();
  const rascunho = page.locator('details.carta-rascunho');
  await rascunho.locator(':scope > summary').click();
  await expect(rascunho).toContainText('Rascunho anotado sozinho.');
  await rascunho.getByRole('button', { name: 'Descartar', exact: true }).click();
  await rascunho.getByRole('button', { name: 'Sim, descartar' }).click();
  await expect(page.locator('details.carta-rascunho')).toHaveCount(0);
});
