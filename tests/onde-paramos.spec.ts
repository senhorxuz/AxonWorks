import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { medirLegibilidade } from './apoio/legibilidade';

/**
 * Tela "Onde paramos" (carta de retorno).
 *
 * Todo dado nasce de verdade pela API e o servidor real responde. O que a API não consegue produzir em
 * tempo real — um projeto parado há 8 dias — se prepara movendo `updated_at` dos cartões direto no banco
 * da suíte (`AXON_E2E_DB_PATH`), a mesma técnica de tests/painel.spec.ts. Checkpoints são imutáveis, por
 * isso os projetos "parados" aqui só têm cartões.
 */

const HEADERS = { 'X-Workspace-Client': 'local' };
const DIA = 86_400_000;

type Coluna = 'ideas' | 'pending' | 'in_progress' | 'unfinished' | 'testing' | 'awaiting_deploy' | 'done' | 'blocked' | 'discarded';

function nomeUnico(base: string) {
  return `${base} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function criarProjeto(request: APIRequestContext, nome: string) {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name: nome, objective: 'Vender cursos pela internet.' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; name: string };
}

async function criarCartao(request: APIRequestContext, projectId: string, titulo: string, coluna: Coluna, descricao?: string) {
  const res = await request.post(`/api/projects/${projectId}/board/cards`, {
    headers: HEADERS,
    data: { actor: 'Claude', title: titulo, column: coluna, ...(descricao ? { description: descricao } : {}) },
  });
  expect(res.ok(), `criar cartão "${titulo}"`).toBeTruthy();
  return (await res.json()) as { id: string };
}

async function proporDecisao(request: APIRequestContext, projectId: string, titulo: string, corpo: string) {
  const res = await request.post(`/api/projects/${projectId}/decisions`, { headers: HEADERS, data: { agent: 'Claude', title: titulo, body: corpo } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; version: number };
}

async function guardarIdeia(request: APIRequestContext, projectId: string, titulo: string) {
  const res = await request.post(`/api/projects/${projectId}/backlog`, {
    headers: HEADERS,
    data: { title: titulo, description: 'Ideia guardada para depois.', priority: 'low', stage: 'idea', createdBy: 'Claude' },
  });
  expect(res.ok(), `guardar ideia "${titulo}"`).toBeTruthy();
}

/** Move a data de atualização do cartão para o passado (arranjo de dados; servidor e tela continuam reais). */
function datarCartao(cardId: string, quando: string) {
  const dbPath = process.env.AXON_E2E_DB_PATH;
  expect(dbPath, 'AXON_E2E_DB_PATH deve estar definido').toBeTruthy();
  const db = new DatabaseSync(dbPath!);
  db.prepare('UPDATE board_cards SET updated_at = ? WHERE id = ?').run(quando, cardId);
  db.close();
}

/** Há `dias` dias e uma hora: o servidor conta 8 dias inteiros, sem depender de milissegundos. */
function haDias(dias: number) {
  return new Date(Date.now() - dias * DIA - 3_600_000).toISOString();
}

/** Projeto "parado": um cartão em andamento cuja última mexida foi há `dias` dias. */
async function projetoParado(request: APIRequestContext, dias: number, nome = nomeUnico('Projeto parado')) {
  const projeto = await criarProjeto(request, nome);
  const cartao = await criarCartao(request, projeto.id, 'Publicar o site', 'in_progress');
  datarCartao(cartao.id, haDias(dias));
  return projeto;
}

async function abrirProjeto(page: Page, projeto: { id: string; name: string }) {
  await page.goto(`/#project/${projeto.id}`);
  await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toBeVisible();
}

async function abrirCarta(page: Page, projeto: { id: string; name: string }) {
  await abrirProjeto(page, projeto);
  const aba = page.getByRole('tab', { name: 'Onde paramos' });
  await expect(aba).toBeVisible();
  if ((await aba.getAttribute('aria-selected')) !== 'true') await aba.click();
  await expect(page.getByRole('heading', { name: 'Onde paramos', level: 2 })).toBeVisible();
}

function grupos(page: Page) {
  return page.locator('.carta [data-grupo]');
}

test('projeto parado há 8 dias abre direto em Onde paramos', async ({ page, request }) => {
  const projeto = await projetoParado(request, 8);

  await abrirProjeto(page, projeto);

  await expect(page.getByRole('tab', { name: 'Onde paramos' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /^Visão geral/ })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('heading', { name: 'Onde paramos', level: 2 })).toBeVisible();
  await expect(page.locator('.carta-ultima')).toHaveText(/^Última vez aqui: \d{1,2} de \p{L}+ de \d{4} \(há 8 dias\)$/u);
});

test('projeto parado há 6 dias ainda abre na aba de sempre', async ({ page, request }) => {
  const projeto = await projetoParado(request, 6);

  await abrirProjeto(page, projeto);

  await expect(page.getByRole('tab', { name: /^Visão geral/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Onde paramos', level: 2 })).toHaveCount(0);
});

test('projeto ativo abre na aba de sempre e Onde paramos fica na aba', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto ativo'));
  await criarCartao(request, projeto.id, 'Escolher o domínio', 'pending');

  await abrirProjeto(page, projeto);

  await expect(page.getByRole('tab', { name: /^Visão geral/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab').first()).toHaveText('Onde paramos');

  await page.getByRole('tab', { name: 'Onde paramos' }).click();

  await expect(page.getByRole('tab', { name: 'Onde paramos' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.carta-ultima')).toContainText('(hoje)');
});

test('cinco grupos na ordem e grupo vazio não aparece', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto completo'));
  await guardarIdeia(request, projeto.id, 'Modo claro para a vitrine');
  await criarCartao(request, projeto.id, 'Escolher o domínio', 'pending');
  await criarCartao(request, projeto.id, 'Publicar o site', 'testing');
  await proporDecisao(request, projeto.id, 'Usar Postgres', 'Por causa da escala.');
  const bloqueio = await request.post(`/api/projects/${projeto.id}/blockers`, {
    headers: HEADERS,
    data: { agent: 'Claude', title: 'Esperando a chave da API', body: 'A chave ainda não chegou.' },
  });
  expect(bloqueio.ok()).toBeTruthy();

  await abrirCarta(page, projeto);

  expect(await grupos(page).evaluateAll(els => els.map(el => el.getAttribute('data-grupo')))).toEqual([
    'precisa_de_voce', 'travado', 'em_andamento', 'a_fazer', 'ideias',
  ]);
  const titulos = await page.locator('.carta [data-grupo] > h4').allTextContents();
  expect(titulos.map(t => t.replace(/\s+/g, ' ').trim())).toEqual([
    'Precisa de você 1', 'Travado 1', 'Em andamento 1', 'A fazer 1', 'Ideias guardadas 1',
  ]);
  // O que cada grupo mostra: a etapa do cartão em andamento e o motivo do bloqueio.
  await expect(page.locator('[data-grupo="em_andamento"]')).toContainText('Em teste');
  await expect(page.locator('[data-grupo="travado"]')).toContainText('Esperando a chave da API');
  await expect(page.locator('[data-grupo="travado"]')).toContainText('Motivo: A chave ainda não chegou.');
});

test('grupo vazio não aparece: só o que existe é mostrado', async ({ page, request }) => {
  const projeto = await projetoParado(request, 1);

  await abrirCarta(page, projeto);

  expect(await grupos(page).evaluateAll(els => els.map(el => el.getAttribute('data-grupo')))).toEqual(['em_andamento']);
  await expect(page.getByRole('region', { name: /^Travado/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /^Precisa de você/ })).toHaveCount(0);
});

test('confirmar decisão proposta pela carta muda o estado de verdade', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto decisão'));
  const decisao = await proporDecisao(request, projeto.id, 'Usar Postgres', 'Por causa da escala.');

  await abrirCarta(page, projeto);
  const precisa = page.locator('[data-grupo="precisa_de_voce"]');
  await expect(precisa).toContainText('Usar Postgres');
  await expect(precisa).toContainText('Decisão proposta');

  await page.getByRole('button', { name: 'Confirmar decisão: Usar Postgres' }).click();

  // O item sai de "Precisa de você" (e, sendo o único, o grupo some).
  await expect(page.locator('[data-grupo="precisa_de_voce"]')).toHaveCount(0);
  await expect(page.getByText('Decisão confirmada', { exact: true })).toBeVisible();
  // O servidor devolve a decisão aceita, assinada por "Dono" (modo local, sem conta logada).
  const lista = await (await request.get(`/api/projects/${projeto.id}/decisions?includeHistory=true`)).json();
  const aceita = lista.find((d: { id: string }) => d.id === decisao.id);
  expect(aceita.status).toBe('accepted');
  expect(aceita.acceptedBy).toBe('Dono');
  // E o resto da tela acompanha: a aba Decisões já conta a decisão vigente.
  await expect(page.getByRole('tab', { name: /^Decisões/ })).toContainText('1');
});

test('decisão que já mudou por outro lado: avisa, atualiza e não aceita duas vezes', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto conflito'));
  const decisao = await proporDecisao(request, projeto.id, 'Usar Postgres', 'Por causa da escala.');
  await abrirCarta(page, projeto);
  await expect(page.locator('[data-grupo="precisa_de_voce"]')).toContainText('Usar Postgres');

  // Outra pessoa (ou IA) aceita a decisão enquanto a tela continua aberta.
  const outra = await request.post(`/api/projects/${projeto.id}/decisions/${decisao.id}/accept`, {
    headers: HEADERS,
    data: { actor: 'Outra pessoa', expectedVersion: decisao.version },
  });
  expect(outra.ok()).toBeTruthy();

  await page.getByRole('button', { name: 'Confirmar decisão: Usar Postgres' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível confirmar “Usar Postgres”' })).toBeVisible();
  await expect(page.locator('[data-grupo="precisa_de_voce"]')).toHaveCount(0);
  const lista = await (await request.get(`/api/projects/${projeto.id}/decisions?includeHistory=true`)).json();
  expect(lista.find((d: { id: string }) => d.id === decisao.id).acceptedBy).toBe('Outra pessoa');
});

test('ideias mostram só a contagem e abrem ao clicar', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto ideias'));
  for (const titulo of ['Modo claro', 'Cupom de boas-vindas', 'Aplicativo no celular']) await guardarIdeia(request, projeto.id, titulo);

  await abrirCarta(page, projeto);

  const ideias = page.locator('[data-grupo="ideias"]');
  await expect(ideias.locator('h4')).toHaveText(/Ideias guardadas\s*3/);
  await expect(page.getByText('Cupom de boas-vindas')).toBeHidden();

  await ideias.getByText('Ver 3 ideias').click();

  for (const titulo of ['Modo claro', 'Cupom de boas-vindas', 'Aplicativo no celular']) {
    await expect(page.getByText(titulo, { exact: true })).toBeVisible();
  }
});

test('sem dado de saúde, a linha não aparece', async ({ page, request }) => {
  const projeto = await projetoParado(request, 8);

  await abrirCarta(page, projeto);

  await expect(page.getByText('Último registro automático')).toHaveCount(0);
  await expect(page.getByText('A conexão com o Claude')).toHaveCount(0);
  await expect(page.locator('.carta-saude')).toHaveCount(0);
});

test.describe('linha de saúde com dado (a carta real ainda não traz saúde: a resposta é completada no caminho)', () => {
  // A frente da conexão automática (ganchos) é quem passará a preencher `saude`. Até lá a rota devolve
  // sempre `null`; aqui só se completa a resposta REAL da rota, sem tocar em nada do servidor.
  async function comSaude(page: Page, projectId: string, saude: (carta: { ultimaAtividade: string }) => unknown) {
    await page.route(`**/api/projects/${projectId}/carta`, async route => {
      const resposta = await route.fetch();
      const carta = await resposta.json();
      await route.fulfill({ response: resposta, json: { ...carta, saude: saude(carta) } });
    });
  }
  const dois = (n: number) => String(n).padStart(2, '0');

  test('registro em dia: mostra quando foi o último', async ({ page, request }) => {
    const projeto = await projetoParado(request, 8);
    let registro = new Date();
    await comSaude(page, projeto.id, carta => {
      registro = new Date(carta.ultimaAtividade);
      return { ultimoRegistroAutomatico: carta.ultimaAtividade, ultimoErro: null };
    });

    await abrirCarta(page, projeto);

    const esperado = `Último registro automático em ${dois(registro.getDate())}/${dois(registro.getMonth() + 1)}, ${registro.getHours()}h.`;
    await expect(page.locator('.carta-saude')).toHaveText(esperado);
  });

  test('conexão calada enquanto o projeto andou: avisa desde quando', async ({ page, request }) => {
    const projeto = await projetoParado(request, 8);
    const registro = new Date(Date.now() - 20 * DIA);
    await comSaude(page, projeto.id, () => ({ ultimoRegistroAutomatico: registro.toISOString(), ultimoErro: null }));

    await abrirCarta(page, projeto);

    await expect(page.locator('.carta-saude')).toHaveText(
      `A conexão com o Claude não registrou nada desde ${dois(registro.getDate())}/${dois(registro.getMonth() + 1)}.`,
    );
  });

  test('erro da conexão aparece na mesma linha', async ({ page, request }) => {
    const projeto = await projetoParado(request, 8);
    await comSaude(page, projeto.id, () => ({ ultimoRegistroAutomatico: null, ultimoErro: 'Banco travado por outro processo' }));

    await abrirCarta(page, projeto);

    await expect(page.locator('.carta-saude')).toHaveText('Último erro da conexão: Banco travado por outro processo.');
  });
});

test('Continuar com o Claude copia a frase', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const projeto = await projetoParado(request, 8, nomeUnico('Alfa Exemplo'));
  await abrirCarta(page, projeto);

  await page.getByRole('button', { name: 'Continuar com o Claude' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Frase copiada. Cole no Claude Code.' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`Retome o projeto ${projeto.name} de onde paramos.`);
});

test('área de transferência indisponível: mostra a frase para copiar à mão', async ({ page, request }) => {
  const projeto = await projetoParado(request, 8, nomeUnico('Alfa Exemplo'));
  await abrirCarta(page, projeto);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('negado')) } });
  });

  await page.getByRole('button', { name: 'Continuar com o Claude' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Não consegui copiar sozinho' })).toBeVisible();
  const campo = page.getByLabel('Frase para colar no Claude Code');
  await expect(campo).toHaveValue(`Retome o projeto ${projeto.name} de onde paramos.`);
  await expect(campo).toBeFocused();
  await expect(page.getByText('Frase copiada.')).toHaveCount(0);
});

test('projeto vazio: cada bloco diz com todas as letras que não há nada ainda', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto vazio'));

  await abrirCarta(page, projeto);

  await expect(page.locator('.carta-ultima')).toHaveText('Ainda não há atividade registrada neste projeto.');
  await expect(page.getByText('Ainda não há uma frase simples do estado do projeto.')).toBeVisible();
  await expect(page.getByText('Nada concluído registrado ainda.')).toBeVisible();
  await expect(page.getByText('Nenhuma pendência registrada')).toBeVisible();
  await expect(grupos(page)).toHaveCount(0);
});

test('o que foi feito: recente aberto, meses antigos recolhidos', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto histórico'));
  const recente = await criarCartao(request, projeto.id, 'Site no ar', 'done');
  const agosto1 = await criarCartao(request, projeto.id, 'Cadastro de alunos', 'done');
  const agosto2 = await criarCartao(request, projeto.id, 'Página de preços', 'done');
  const julho = await criarCartao(request, projeto.id, 'Logo definida', 'done');
  datarCartao(recente.id, haDias(8));
  datarCartao(agosto1.id, '2026-08-10T12:00:00.000Z');
  datarCartao(agosto2.id, '2026-08-12T12:00:00.000Z');
  datarCartao(julho.id, '2026-07-03T12:00:00.000Z');

  await abrirCarta(page, projeto);

  const feito = page.locator('.carta-bloco').filter({ has: page.getByRole('heading', { name: 'O que foi feito' }) });
  await expect(feito.getByText('Site no ar')).toBeVisible();
  const meses = feito.locator('details.carta-mes > summary');
  await expect(meses).toHaveText(['agosto de 2026 · 2 itens', 'julho de 2026 · 1 item']);
  await expect(feito.getByText('Cadastro de alunos')).toBeHidden();

  await meses.first().click();

  await expect(feito.getByText('Cadastro de alunos')).toBeVisible();
  await expect(feito.getByText('Página de preços')).toBeVisible();
  await expect(feito.getByText('Logo definida')).toBeHidden();
});

test('última sessão anotada sozinha aparece com o aviso de que ainda não foi registrada', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto rascunho'));
  const rascunho = await request.post(`/api/projects/${projeto.id}/drafts`, {
    headers: HEADERS,
    data: {
      agent: 'Claude (automático)',
      expectedVersion: 0,
      summary: 'Mexemos no cadastro de alunos e deixamos a página de preços pela metade.',
      nextAction: 'O registro desta etapa ainda não foi gravado; ver o resumo acima.',
    },
  });
  expect(rascunho.ok()).toBeTruthy();

  await abrirCarta(page, projeto);

  await expect(page.getByText('Mexemos no cadastro de alunos')).toBeHidden();
  await page.getByText('Última sessão, anotada sozinha').click();
  await expect(page.getByText('Mexemos no cadastro de alunos e deixamos a página de preços pela metade.')).toBeVisible();
  await expect(page.getByText('O registro desta etapa ainda não foi gravado na Axon.')).toBeVisible();
});

test('falha ao ler a carta: avisa e deixa tentar de novo', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto falha'));
  await page.route(`**/api/projects/${projeto.id}/carta`, route =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'falha', message: 'Falha de teste ao ler a carta.' } }) }),
  );
  await abrirProjeto(page, projeto);
  // Com a carta fora do ar, o projeto abre na aba de sempre; a aba continua lá.
  await expect(page.getByRole('tab', { name: /^Visão geral/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: 'Onde paramos' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Falha de teste ao ler a carta.' })).toBeVisible();
  await page.unroute(`**/api/projects/${projeto.id}/carta`);
  await page.getByRole('button', { name: 'Tentar novamente' }).click();

  await expect(page.getByRole('heading', { name: 'Onde paramos', level: 2 })).toBeVisible();
});

test('contraste e tamanho mínimo', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto legível'));
  const longo = 'Descrição longa do cartão para exercitar o "Ver tudo". '.repeat(8);
  await criarCartao(request, projeto.id, 'Publicar o site', 'in_progress', longo);
  await criarCartao(request, projeto.id, 'Escolher o domínio', 'pending');
  const feito = await criarCartao(request, projeto.id, 'Site no ar', 'done');
  const antigo = await criarCartao(request, projeto.id, 'Logo definida', 'done');
  datarCartao(feito.id, haDias(2));
  datarCartao(antigo.id, '2026-07-03T12:00:00.000Z');
  await guardarIdeia(request, projeto.id, 'Modo claro');
  await proporDecisao(request, projeto.id, 'Usar Postgres', 'Por causa da escala.');
  await request.post(`/api/projects/${projeto.id}/blockers`, { headers: HEADERS, data: { agent: 'Claude', title: 'Esperando a chave', body: 'A chave ainda não chegou.' } });
  await request.post(`/api/projects/${projeto.id}/approvals`, {
    headers: HEADERS,
    data: { agent: 'Gemini', kind: 'note', title: 'Ajuste de contraste', body: 'Trocar a cor do rótulo.', rationale: 'Cumprir o contraste mínimo.' },
  });
  await request.post(`/api/projects/${projeto.id}/drafts`, {
    headers: HEADERS,
    data: { agent: 'Claude (automático)', expectedVersion: 0, summary: 'Resumo da última sessão.', nextAction: 'O registro desta etapa ainda não foi gravado; ver o resumo acima.' },
  });

  await abrirCarta(page, projeto);
  // Abre tudo o que nasce recolhido: o que está escondido também precisa ser legível.
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
  await page.waitForTimeout(400);

  const medida = await page.evaluate(medirLegibilidade);

  expect(medida.totalTextos).toBeGreaterThan(25);
  expect(medida.falhasTamanho, 'textos abaixo do tamanho mínimo').toEqual([]);
  expect(medida.falhasContraste, 'textos com contraste insuficiente').toEqual([]);
});

test('no celular a página não passa da largura da tela e o botão principal cabe', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const projeto = await projetoParado(request, 8);
  await criarCartao(request, projeto.id, 'Um título de cartão comprido para quebrar linha no celular sem estourar a tela', 'pending');
  await proporDecisao(request, projeto.id, 'Usar Postgres', 'Por causa da escala.');

  await abrirCarta(page, projeto);

  const botao = page.getByRole('button', { name: 'Continuar com o Claude' });
  await botao.scrollIntoViewIfNeeded();
  await expect(botao).toBeVisible();
  const caixa = await botao.boundingBox();
  expect(caixa!.x).toBeGreaterThanOrEqual(0);
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(390);
  expect(caixa!.height).toBeGreaterThanOrEqual(44);
  const transbordo = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(transbordo).toBeLessThanOrEqual(0);
  await expect(page.getByRole('button', { name: 'Confirmar decisão: Usar Postgres' })).toBeVisible();
});
