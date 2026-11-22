import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { EstadoDaEntrega } from '../shared/entrega';
import { WorkspaceStore } from '../server/store';
import { medirLegibilidade } from './apoio/legibilidade';

const headers = { 'X-Workspace-Client': 'local' };
const titulo = 'Mostrar os depoimentos no site';
const fraseDoDono = 'Pode publicar na prévia para eu conferir.';
const pedidoDoDono = 'Desfaz a autorização para produção.';

async function prepararCartao(request: APIRequestContext, nome: string) {
  const projeto = await request.post('/api/projects', { headers, data: { name: nome, objective: 'Organizar as entregas do site.' } });
  expect(projeto.status()).toBe(201);
  const { id: projetoId } = await projeto.json();
  const cartao = await request.post(`/api/projects/${projetoId}/board/cards`, {
    headers, data: { actor: 'Claude', title: titulo, column: 'in_progress' },
  });
  expect(cartao.status()).toBe(201);
  return { projetoId: projetoId as string, cartaoId: (await cartao.json()).id as string };
}

function registrarTrabalho(projetoId: string, cartaoId: string) {
  const bancoDaSuite = process.env.AXON_E2E_DB_PATH;
  if (!bancoDaSuite) throw new Error('O Playwright precisa fornecer o caminho do banco isolado.');
  const store = new WorkspaceStore(bancoDaSuite);
  try {
    store.updateDelivery(projetoId, cartaoId, { agent: 'Claude', testes: { estado: 'passando' }, codigo: { onde: 'local', commit: 'a1b2c3d' } });
    store.recordOwnerApproval(projetoId, cartaoId, { agent: 'Claude', tipo: 'publicacao', ambiente: 'prévia', fraseDoDono });
    store.updateDelivery(projetoId, cartaoId, { agent: 'Claude', publicacao: { ambiente: 'prévia' } });
    const estado = store.recordOwnerApproval(projetoId, cartaoId, {
      agent: 'Claude', tipo: 'publicacao', ambiente: 'produção', fraseDoDono: 'Pode publicar em produção.',
    });
    store.undoOwnerApproval(projetoId, cartaoId, estado.aprovacoes[1].id, { chat: { agent: 'Codex', pedidoDoDono } });
  } finally {
    store.close();
  }
}

async function abrirQuadro(page: Page, projetoId: string) {
  await page.goto(`/#project/${projetoId}`);
  await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
}

test('aprova o visual, autoriza staging e desfaz as aprovações com a origem à vista', async ({ page, request }) => {
  const { projetoId, cartaoId } = await prepararCartao(request, 'Entregas com aprovação');
  registrarTrabalho(projetoId, cartaoId);
  await abrirQuadro(page, projetoId);
  const cartao = page.getByRole('button', { name: new RegExp(`^${titulo}`) });
  await expect(cartao).toContainText('Visual pendente');
  await expect(cartao).toHaveAccessibleDescription(/Testes passando \(relato\).*Código no PC/);
  await expect(cartao).toContainText('prévia: publicada (relato)');
  // Ninguém citou staging ainda: ele não aparece. Produção foi citada e a autorização desfeita: volta a pendente.
  await expect(cartao).not.toContainText('staging');
  await expect(cartao).toContainText('produção: publicação pendente');

  await cartao.press('Enter');
  const entrega = page.getByRole('region', { name: 'Entrega', exact: true });
  const chat = entrega.getByRole('listitem').filter({ hasText: 'Publicação em prévia' });
  await expect(chat).toContainText('Dito por você no chat, registrado por Claude (nome declarado)');
  await expect(chat).toContainText(fraseDoDono);
  await expect(entrega.getByRole('listitem').filter({ hasText: 'Publicação em produção' }))
    .toContainText(`Desfeita por Codex (nome declarado) a seu pedido: '${pedidoDoDono}'`);

  await entrega.getByRole('button', { name: 'Aprovar visual' }).click();
  const visual = entrega.getByRole('listitem').filter({ hasText: 'Visual' });
  await expect(visual).toContainText('Aprovado por você na tela');
  const campo = entrega.getByRole('textbox', { name: 'Ambiente de publicação' });
  await campo.fill(' staging ');
  await campo.press('Tab');
  const autorizar = entrega.getByRole('button', { name: 'Autorizar publicação em staging' });
  await expect(autorizar).toBeFocused();
  await expect(autorizar).toHaveCSS('outline-style', 'solid');
  await autorizar.press('Enter');
  const staging = entrega.getByRole('listitem').filter({ hasText: 'Publicação em staging' });
  await expect(staging).toContainText('Aprovado por você na tela');
  await expect(entrega.getByText('staging: publicação autorizada', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Fechar cartão' }).click();
  await expect(cartao).toContainText('Visual aprovado');
  await expect(cartao).toContainText('staging: publicação autorizada');
  await conferirLegibilidadeDaEntrega(page);
  await page.getByRole('tab', { name: 'Onde paramos', exact: true }).click();
  const emAndamento = page.getByRole('region', { name: 'Entregas em andamento' });
  await expect(emAndamento.getByRole('listitem')).toHaveCount(1);
  await expect(emAndamento).toContainText(titulo);
  await expect(emAndamento).toContainText('código no PC, versão a1b2c3d');
  await expect(emAndamento).toContainText('publicação autorizada para staging');
  await conferirLegibilidadeDaEntrega(page);

  await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
  await cartao.click();
  await staging.getByRole('button', { name: 'Desfazer publicação em staging' }).press('Enter');
  await expect(staging).toContainText('Desfeita por você na tela');
  await expect(entrega.getByRole('heading', { name: 'Entrega', exact: true })).toBeFocused();
  await chat.getByRole('button', { name: 'Desfazer publicação em prévia' }).click();
  await expect(chat).toContainText('Desfeita por você na tela');
  await expect(chat).toContainText(fraseDoDono);
  await expect(entrega.getByText('prévia: publicada (relato)', { exact: true })).toBeVisible();
  await visual.getByRole('button', { name: 'Desfazer visual' }).click();
  await expect(visual).toContainText('Desfeita por você na tela');

  await conferirLegibilidadeDaEntrega(page);

  await page.keyboard.press('Escape');
  await expect(cartao).toContainText('Visual pendente');
  await expect(cartao).toContainText('staging: publicação pendente');
  await page.getByRole('tab', { name: 'Onde paramos', exact: true }).click();
  await expect(emAndamento).toContainText('publicação pendente: falta autorização para staging');
  const resposta = await request.get(`/api/projects/${projetoId}/entregas/${cartaoId}`);
  expect(resposta.status()).toBe(200);
  const estado: EstadoDaEntrega = await resposta.json();
  expect(estado.aprovacoes.map(aprovacao => Boolean(aprovacao.desfeitaEm))).toEqual([true, true, true, true]);
  expect(estado.publicacoes.map(publicacao => publicacao.ambiente)).toEqual(['prévia']);
});

test('um cartão sem entrega abre vazio e permite começar com a primeira aprovação', async ({ page, request }) => {
  const { projetoId } = await prepararCartao(request, 'Entregas ainda vazias');
  await abrirQuadro(page, projetoId);
  await page.getByRole('tab', { name: 'Onde paramos', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Entregas em andamento' })).toContainText('Nenhuma entrega em andamento.');

  await page.getByRole('tab', { name: 'Quadro', exact: true }).click();
  const cartao = page.getByRole('button', { name: new RegExp(`^${titulo}`) });
  await expect(cartao).not.toContainText('Visual pendente');
  await cartao.click();
  const entrega = page.getByRole('region', { name: 'Entrega', exact: true });
  await expect(entrega).toContainText('Ainda não há registros desta entrega.');
  await entrega.getByRole('button', { name: 'Aprovar visual' }).click();
  await expect(entrega.getByText('Visual aprovado', { exact: true })).toBeVisible();
});

test('distingue carregamento, falha de leitura e gravação recusada, com nova tentativa', async ({ page, request }) => {
  const { projetoId, cartaoId } = await prepararCartao(request, 'Entregas com nova tentativa');
  const caminhoDaLista = `**/api/projects/${projetoId}/entregas`;
  const caminho = `${caminhoDaLista}/${cartaoId}`;
  await page.route(caminhoDaLista, route => route.fulfill({ status: 503, json: { error: { code: 'falha', message: 'Lista indisponível.' } } }));
  let responder: () => void = () => {};
  const aguardar = new Promise<void>(resolve => { responder = resolve; });
  await page.route(caminho, async route => {
    await aguardar;
    await route.fulfill({ status: 500, json: { error: { code: 'falha', message: 'Falha ao ler.' } } });
  });
  await abrirQuadro(page, projetoId);
  const erroDaLista = page.getByRole('alert').filter({ hasText: 'Não foi possível atualizar os selos das entregas.' });
  await expect(erroDaLista).toBeVisible();
  await page.unroute(caminhoDaLista);
  await erroDaLista.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(erroDaLista).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(`^${titulo}`) }).click();
  const entrega = page.getByRole('region', { name: 'Entrega', exact: true });
  try {
    await expect(entrega.getByRole('status')).toHaveText('Carregando a entrega…');
    await expect(entrega.getByRole('button', { name: 'Aprovar visual' })).toHaveCount(0);
  } finally {
    responder();
  }
  await expect(entrega.getByRole('alert')).toContainText('Não foi possível carregar a entrega.');
  await page.unroute(caminho);
  await entrega.getByRole('button', { name: 'Tentar novamente' }).click();
  const aprovar = entrega.getByRole('button', { name: 'Aprovar visual' });
  await page.route(`${caminho}/aprovar`, route =>
    route.fulfill({ status: 403, json: { error: { code: 'so_o_dono', message: 'Só o dono pode aprovar.' } } }),
  );
  await aprovar.click();
  await expect(entrega.getByRole('alert')).toContainText('Só o dono pode aprovar.');
  await expect(entrega.getByText('Visual aprovado', { exact: true })).toHaveCount(0);
  await page.unroute(`${caminho}/aprovar`);
  await aprovar.click();
  await expect(entrega.getByText('Visual aprovado', { exact: true })).toBeVisible();
});

async function conferirLegibilidadeDaEntrega(page: Page) {
  const medida = await page.evaluate(medirLegibilidade);
  expect(medida.falhasContraste.filter(falha => falha.classe.includes('entrega-'))).toEqual([]);
  expect(medida.falhasTamanho.filter(falha => falha.classe.includes('entrega-'))).toEqual([]);
}
