import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { WorkspaceStore } from '../server/store';

const headers = { 'X-Workspace-Client': 'local' };
const anterior = 'Vender apenas livros usados.';
const objetivo = 'Vender livros novos e usados.';
const motivo = 'O catálogo de livros novos entrou no ar.';

async function criarAtualizacao(request: APIRequestContext) {
  const resposta = await request.post('/api/projects', {
    headers, data: { name: `Livraria ${randomUUID()}`, objective: anterior },
  });
  expect(resposta.status()).toBe(201);
  const { id } = await resposta.json() as { id: string };
  const arquivo = process.env.AXON_E2E_DB_PATH;
  if (!arquivo) throw new Error('O banco de teste não foi configurado.');
  const store = new WorkspaceStore(arquivo);
  try {
    store.updateProjectObjective(id, { agent: 'Codex', objetivo, motivo, expectedRevision: 1 });
  } finally {
    store.close();
  }
  return id;
}

async function abrir(page: Page, id: string) {
  await page.goto(`/#project/${id}`);
  await page.getByRole('tab', { name: 'Diretriz', exact: true }).click();
  return page.getByRole('region', { name: 'Diretriz do projeto' });
}

test('mostra a autoria e registra a conferência do dono sem criar outra revisão', async ({ page, request }) => {
  const id = await criarAtualizacao(request);
  const painel = await abrir(page, id);
  await expect(painel.getByText(objetivo, { exact: true })).toBeVisible();
  await expect(painel.getByText(/Atualizada por Codex \(nome declarado\) em \d{2}\/\d{2}\/\d{4}:/)).toContainText(motivo);
  await painel.getByRole('button', { name: 'Está certo' }).click();
  await expect(painel.getByRole('status')).toContainText('Diretriz conferida');
  const atual = await request.get(`/api/projects/${id}/charter`);
  expect(await atual.json()).toMatchObject({ revision: 2, sourceKind: 'agent_update', vistoPeloDonoEm: expect.any(String) });
  await expect(painel.getByRole('button', { name: 'Está certo' })).toHaveCount(0);
  await expect(painel.getByText(/Atualizada por Codex/)).toBeVisible();
  await expect(painel.getByRole('button', { name: 'Voltar ao meu texto' })).toBeEnabled();
});

test('mostra carregamento e uma recusa da ação antes de restaurar o texto anterior', async ({ page, request }) => {
  const id = await criarAtualizacao(request);
  const rota = `**/api/projects/${id}/charter/desfazer`;
  let liberar!: () => void;
  const espera = new Promise<void>(resolve => { liberar = resolve; });
  await page.route(rota, async route => {
    await espera;
    await route.fulfill({ status: 409, json: { error: { code: 'nada_a_desfazer', message: 'Não foi possível voltar ao texto anterior.' } } });
  });
  const painel = await abrir(page, id);
  const voltar = painel.getByRole('button', { name: 'Voltar ao meu texto' });
  await voltar.click();
  try {
    await expect(painel.getByRole('status')).toContainText('Voltando ao seu texto');
    await expect(voltar).toBeDisabled();
    await expect(painel.getByRole('button', { name: 'Está certo' })).toBeDisabled();
  } finally {
    liberar();
  }
  await expect(painel.getByRole('alert')).toContainText('Não foi possível voltar ao texto anterior.');
  await page.unroute(rota);
  await voltar.click();
  await expect(painel.getByText(anterior, { exact: true })).toBeVisible();
  await expect(painel.getByRole('status')).toContainText('Seu texto voltou a ser a diretriz');
  const atual = await request.get(`/api/projects/${id}/charter`);
  expect(await atual.json()).toMatchObject({ revision: 3, sourceKind: 'human_directive', body: anterior, createdBy: 'Dono' });
});

test('recupera a leitura da diretriz e mantém a edição disponível na Visão geral', async ({ page, request }) => {
  const id = await criarAtualizacao(request);
  const rota = `**/api/projects/${id}/charter`;
  let liberar!: () => void;
  const espera = new Promise<void>(resolve => { liberar = resolve; });
  await page.route(rota, async route => {
    await espera;
    await route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Diretriz indisponível.' } } });
  });
  const painel = await abrir(page, id);
  try {
    await expect(painel.getByRole('status')).toContainText('Buscando a diretriz');
    await expect(painel.getByRole('button', { name: 'Editar diretriz' })).toHaveCount(0);
  } finally {
    liberar();
  }
  await expect(painel.getByRole('alert')).toHaveText('Diretriz indisponível.');
  await page.unroute(rota);
  await painel.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(painel.getByText(objetivo, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Visão geral' }).click();
  await page.getByRole('textbox', { name: 'Nome do agente' }).fill('Dono');
  await painel.getByRole('button', { name: 'Editar diretriz' }).click();
  const campo = painel.getByRole('textbox', { name: 'Texto vigente da diretriz do projeto' });
  await expect(campo).toHaveValue(objetivo);
  const alteracao = 'Vender livros, cadernos e mapas.';
  await campo.fill(alteracao);
  await painel.getByRole('button', { name: 'Salvar versão' }).click();
  await expect(painel.getByText(alteracao, { exact: true })).toBeVisible();
  await expect(painel.getByRole('status')).toContainText('Diretriz salva');
  const atual = await request.get(`/api/projects/${id}/charter`);
  expect(await atual.json()).toMatchObject({ revision: 3, sourceKind: 'human_directive', body: alteracao });
});
