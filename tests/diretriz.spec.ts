import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page, type APIRequestContext } from '@playwright/test';
import { WorkspaceStore } from '../server/store';
import { medirLegibilidade } from './apoio/legibilidade';

const headers = { 'X-Workspace-Client': 'local' };
const anterior = 'Vender apenas livros usados.';
const objetivo = 'Vender livros novos e usados.';
const motivo = 'O catálogo de livros novos entrou no ar.';

const textoComTitulos = [
  'OBJETIVO',
  'Vender livros usados. Entregar em dois dias.',
  '',
  'O QUE A LOJA NUNCA FAZ',
  'Vender sem nota fiscal. Esconder o preço do cliente.',
  '',
  'QUANDO ESTÁ PRONTO',
  '- Catálogo no ar.',
  '- Pagamento testado.',
  '',
  'RISCOS',
  'Estoque pequeno. Atraso da transportadora.',
  '',
  'COMO TRABALHAR',
  '- Falar com o cliente.',
  '- Registrar tudo.',
].join('\n');

/** Nome só com dígitos: nenhuma palavra dele vira maiúscula no meio dos títulos. */
const nomeNumerico = () => `Loja ${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function criarProjeto(request: APIRequestContext, texto: string): Promise<{ id: string; name: string }> {
  const resposta = await request.post('/api/projects', { headers, data: { name: nomeNumerico(), objective: texto } });
  expect(resposta.status()).toBe(201);
  return resposta.json() as Promise<{ id: string; name: string }>;
}

async function novaVersao(request: APIRequestContext, id: string, body: string, expectedRevision: number) {
  const resposta = await request.post(`/api/projects/${id}/charter`, { headers, data: { actor: 'Dono', body, expectedRevision } });
  expect(resposta.ok()).toBeTruthy();
}

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

/** Elementos da folha que passam da borda direita dela (a rolagem de lado da página, que vem da barra de abas, não conta). */
function foraDaFolha(folha: Locator) {
  return folha.evaluate(raiz => {
    const limite = raiz.getBoundingClientRect().right + 1;
    return [...raiz.querySelectorAll('*')].filter(el => el.closest('.dz-linha-do-tempo') === null && el.getBoundingClientRect().right > limite).map(el => el.className.toString());
  });
}

async function abrir(page: Page, id: string) {
  await page.goto(`/#project/${id}`);
  await page.getByRole('tab', { name: 'Diretriz', exact: true }).click();
  return page.getByRole('region', { name: 'Diretriz do projeto' });
}

test('o objetivo vira manchete e as outras seções viram artigos com título legível', async ({ page, request }) => {
  const projeto = await criarProjeto(request, textoComTitulos);
  const folha = await abrir(page, projeto.id);
  await expect(folha.locator('.dz-lide')).toHaveText('Vender livros usados.');
  await expect(folha.locator('.dz-lide-resto')).toHaveText('Entregar em dois dias.');
  await expect(folha.locator('.dz-objetivo-titulo')).toHaveText('Objetivo');
  await expect(folha.locator('.dz-artigo')).toHaveCount(4);
  await expect(folha.getByRole('heading', { name: 'O que a Loja nunca faz' })).toBeVisible();
  await expect(folha.getByRole('heading', { name: 'Quando está pronto' })).toBeVisible();
  await expect(folha.locator('.dz-artigo').nth(1).getByRole('listitem')).toHaveText(['Catálogo no ar.', 'Pagamento testado.']);
});

test('texto sem títulos em maiúsculas: manchete só, sem índice nem artigos', async ({ page, request }) => {
  const projeto = await criarProjeto(request, 'Um texto corrido, sem títulos. Ele continua inteiro na tela.');
  const folha = await abrir(page, projeto.id);
  await expect(folha.locator('.dz-lide')).toHaveText('Um texto corrido, sem títulos.');
  await expect(folha.locator('.dz-lide-resto')).toHaveText('Ele continua inteiro na tela.');
  await expect(folha.locator('.dz-artigo')).toHaveCount(0);
  await expect(folha.getByRole('navigation', { name: 'Seções da diretriz' })).toHaveCount(0);
});

test('cada seção ganha o símbolo do seu tom: nunca, pronto, risco e como trabalhar', async ({ page, request }) => {
  const projeto = await criarProjeto(request, textoComTitulos);
  const folha = await abrir(page, projeto.id);
  const marca = (tom: string) => folha.locator(`.dz-artigo[data-tom="${tom}"] li`).first().evaluate(li => getComputedStyle(li, '::before').content);
  expect(await marca('nunca')).toBe('"✕"');
  expect(await marca('pronto')).toBe('"✓"');
  expect(await marca('risco')).toBe('"△"');
  expect(await marca('como')).toBe('"→"');
});

test('o índice leva à seção, que acende e recebe o foco', async ({ page, request }) => {
  const projeto = await criarProjeto(request, textoComTitulos);
  const folha = await abrir(page, projeto.id);
  const indice = folha.getByRole('navigation', { name: 'Seções da diretriz' });
  await expect(indice.getByRole('link')).toHaveCount(4);
  await indice.getByRole('link', { name: /Riscos/ }).click();
  const risco = folha.locator('.dz-artigo[data-tom="risco"]');
  await expect(risco).toHaveClass(/axon-chegou/);
  await expect(risco).toBeFocused();
  await expect(indice.getByRole('link', { name: /Riscos/ })).toHaveAttribute('aria-current', 'location');
  await expect(risco).not.toHaveClass(/axon-chegou/, { timeout: 6000 });
});

test('com movimento reduzido o destino fica marcado por um contorno parado, sem animação', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const projeto = await criarProjeto(request, textoComTitulos);
  const folha = await abrir(page, projeto.id);
  await folha.getByRole('navigation', { name: 'Seções da diretriz' }).getByRole('link', { name: /Riscos/ }).click();
  const risco = folha.locator('.dz-artigo[data-tom="risco"]');
  await expect(risco).toHaveClass(/axon-chegou/);
  const estilo = await risco.evaluate(el => { const cs = getComputedStyle(el); return { animacao: cs.animationName, contorno: cs.outlineStyle, largura: cs.outlineWidth }; });
  expect(estilo).toEqual({ animacao: 'none', contorno: 'solid', largura: '2px' });
  await expect(risco).not.toHaveClass(/axon-chegou/, { timeout: 5000 });
});

test('o selo tem um anel por versão, com a vigente marcada', async ({ page, request }) => {
  const projeto = await criarProjeto(request, textoComTitulos);
  await novaVersao(request, projeto.id, `${textoComTitulos}\n\nPÚBLICO\nLeitores de sebo.`, 1);
  await novaVersao(request, projeto.id, `${textoComTitulos}\n\nPÚBLICO\nLeitores de sebo e de novos.`, 2);
  const folha = await abrir(page, projeto.id);
  const selo = folha.getByRole('img', { name: 'Selo da diretriz: 3 versões, a vigente é a 3' });
  await expect(selo).toBeVisible();
  await expect(selo.locator('path')).toHaveCount(6);
  await expect(selo.locator('path.vigente')).toHaveCount(2);
  await expect(selo.locator('.dz-centro-n')).toHaveText('v3');
  await expect(selo.locator('.dz-centro-r')).toHaveText('VIGENTE');
  await expect(folha.getByText('Escrita ou conferida por você')).toBeVisible();
});

test('a legenda do selo conta os registros feitos depois da versão vigente', async ({ page, request }) => {
  const projeto = await criarProjeto(request, textoComTitulos);
  const atual = await (await request.get(`/api/projects/${projeto.id}`, { headers })).json() as { project: { revision: number } };
  await new Promise(resolve => setTimeout(resolve, 20));
  const registro = await request.post(`/api/projects/${projeto.id}/checkpoints`, { headers, data: {
    agent: 'Codex', expectedRevision: atual.project.revision, idempotencyKey: randomUUID(), summary: 'Feito.', humanSummary: 'Entrou o catálogo.', nextStep: 'Seguir.',
  } });
  expect(registro.ok()).toBeTruthy();
  const folha = await abrir(page, projeto.id);
  await expect(folha.locator('.dz-selo-legenda')).toContainText('Desde então, 1 registro no projeto.');
});

test('clicar numa versão antiga mostra o texto dela e o botão "Voltar à vigente"', async ({ page, request }) => {
  const projeto = await criarProjeto(request, 'OBJETIVO\nPrimeira versão do objetivo.\n\nRISCOS\nUm risco antigo.');
  await novaVersao(request, projeto.id, 'OBJETIVO\nSegunda versão do objetivo.\n\nRISCOS\nUm risco novo.', 1);
  const folha = await abrir(page, projeto.id);
  await expect(folha.locator('.dz-lide')).toHaveText('Segunda versão do objetivo.');
  const linha = folha.locator('.dz-linha-do-tempo');
  await expect(linha.getByRole('button', { name: /Versão 2 · vigente/ })).toBeVisible();
  await linha.getByRole('button', { name: /^Versão 1/ }).click();
  await expect(folha.locator('.dz-lide')).toHaveText('Primeira versão do objetivo.');
  await expect(folha.getByText(/Você está vendo a versão 1, de .+ Ela não vale mais\./)).toBeVisible();
  await expect(folha.getByRole('button', { name: 'Editar diretriz' })).toHaveCount(0);
  await expect(folha.locator('.dz-centro-r')).toHaveText('ANTIGA');
  await expect(linha.getByRole('button', { name: /^Versão 1/ })).toHaveAttribute('aria-current', 'true');
  await folha.getByRole('button', { name: 'Voltar à vigente' }).click();
  await expect(folha.locator('.dz-lide')).toHaveText('Segunda versão do objetivo.');
  await expect(folha.getByRole('button', { name: 'Voltar à vigente' })).toHaveCount(0);
  await expect(folha.getByRole('button', { name: 'Editar diretriz' })).toBeVisible();
});

test('editar mostra "Como vai ficar" mudando a cada letra; salvar cria a versão seguinte, assinada pelo dono quando não há nome', async ({ page, request }) => {
  const projeto = await criarProjeto(request, 'OBJETIVO\nVender livros usados.\n\nRISCOS\nEstoque pequeno.');
  const folha = await abrir(page, projeto.id);
  await folha.getByRole('button', { name: 'Editar diretriz' }).click();
  const campo = folha.getByRole('textbox', { name: 'Texto vigente da diretriz do projeto' });
  await expect(campo).toBeFocused();
  const salvar = folha.getByRole('button', { name: 'Salvar versão 2' });
  await expect(salvar).toBeDisabled();
  const vivo = folha.locator('.dz-ao-vivo');
  await expect(vivo.getByRole('heading', { name: 'Riscos' })).toBeVisible();
  await campo.fill('OBJETIVO\nVender livros usados.\n\nRISCOS\nEstoque pequeno.\n\nPÚBLICO\nLeitores de sebo.');
  await expect(vivo.getByRole('heading', { name: 'Público' })).toBeVisible();
  await expect(salvar).toBeEnabled();
  await salvar.click();
  await expect(folha.getByRole('status')).toContainText('Diretriz salva');
  await expect(folha.getByRole('heading', { name: 'Público' })).toBeVisible();
  await expect(folha.getByRole('button', { name: /Versão 2 · vigente/ })).toBeVisible();
  const atual = await (await request.get(`/api/projects/${projeto.id}/charter`)).json();
  expect(atual).toMatchObject({ revision: 2, sourceKind: 'human_directive', createdBy: 'Dono do projeto' });
});

test('cancelar a edição volta à folha sem criar versão', async ({ page, request }) => {
  const projeto = await criarProjeto(request, 'OBJETIVO\nVender livros usados.');
  const folha = await abrir(page, projeto.id);
  await folha.getByRole('button', { name: 'Editar diretriz' }).click();
  await folha.getByRole('textbox', { name: 'Texto vigente da diretriz do projeto' }).fill('Outra coisa.');
  await folha.getByRole('button', { name: 'Cancelar' }).click();
  await expect(folha.locator('.dz-lide')).toHaveText('Vender livros usados.');
  expect(await (await request.get(`/api/projects/${projeto.id}/charter`)).json()).toMatchObject({ revision: 1 });
});

test('mostra a autoria e registra a conferência do dono sem criar outra revisão', async ({ page, request }) => {
  const id = await criarAtualizacao(request);
  const painel = await abrir(page, id);
  await expect(painel.locator('.dz-lide')).toHaveText(objetivo);
  await expect(painel.getByText('Uma IA atualizou: confira')).toBeVisible();
  await expect(painel.getByText(/^Codex \(nome declarado\) atualizou esta diretriz em \d{1,2} de .+ de \d{4}: O catálogo de livros novos entrou no ar\. Confira e diga se está certo\.$/)).toBeVisible();
  await expect(painel.getByRole('button', { name: /Versão 2 · vigente/ })).toContainText('Codex (IA)');
  await painel.getByRole('button', { name: 'Está certo' }).click();
  await expect(painel.getByRole('status')).toContainText('Diretriz conferida');
  const atual = await request.get(`/api/projects/${id}/charter`);
  expect(await atual.json()).toMatchObject({ revision: 2, sourceKind: 'agent_update', vistoPeloDonoEm: expect.any(String) });
  await expect(painel.getByRole('button', { name: 'Está certo' })).toHaveCount(0);
  await expect(painel.getByText('Escrita ou conferida por você')).toBeVisible();
  await expect(painel.locator('.dz-selo-legenda')).toContainText('escrita por Codex (IA)');
  await expect(painel.getByRole('button', { name: /Versão 2 · vigente/ })).toContainText('Codex (IA)');
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
  await expect(painel.locator('.dz-lide')).toHaveText(anterior);
  await expect(painel.getByRole('status')).toContainText('Seu texto voltou a ser a diretriz');
  await expect(painel.getByRole('button', { name: /Versão 3 · vigente/ })).toBeVisible();
  const atual = await request.get(`/api/projects/${id}/charter`);
  expect(await atual.json()).toMatchObject({ revision: 3, sourceKind: 'human_directive', body: anterior, createdBy: 'Dono' });
});

test('recupera a leitura da diretriz e a edição segue disponível depois de abrir a aba pela Visão geral', async ({ page, request }) => {
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
  await expect(painel.locator('.dz-lide')).toHaveText(objetivo);
  await page.getByRole('tab', { name: 'Visão geral' }).click();
  await page.getByRole('button', { name: 'Abrir a diretriz' }).click();
  await expect(painel).toHaveClass(/axon-chegou/);
  await painel.getByRole('button', { name: 'Editar diretriz' }).click();
  const campo = painel.getByRole('textbox', { name: 'Texto vigente da diretriz do projeto' });
  await expect(campo).toHaveValue(objetivo);
  const alteracao = 'Vender livros, cadernos e mapas.';
  await campo.fill(alteracao);
  await painel.getByRole('button', { name: 'Salvar versão 3' }).click();
  await expect(painel.locator('.dz-lide')).toHaveText(alteracao);
  await expect(painel.getByRole('status')).toContainText('Diretriz salva');
  const atual = await request.get(`/api/projects/${id}/charter`);
  expect(await atual.json()).toMatchObject({ revision: 3, sourceKind: 'human_directive', body: alteracao, createdBy: 'Dono do projeto' });
});

test('a folha é legível: texto de 11 px ou mais e contraste de 4,5 para 1, no computador e no celular', async ({ page, request }) => {
  const projeto = await criarProjeto(request, textoComTitulos);
  await novaVersao(request, projeto.id, `${textoComTitulos}\n\nPÚBLICO\nLeitores de sebo.`, 1);
  const folha = await abrir(page, projeto.id);
  await expect(folha.locator('.dz-artigo')).toHaveCount(5);
  const medida = await page.evaluate(medirLegibilidade);
  expect(medida.falhasTamanho, 'textos abaixo do tamanho mínimo').toEqual([]);
  expect(medida.falhasContraste, 'textos com contraste insuficiente').toEqual([]);
  const editar = folha.getByRole('button', { name: 'Editar diretriz' });
  await editar.hover();
  await page.waitForTimeout(400);
  const comMouseEmCima = await page.evaluate(medirLegibilidade);
  expect(comMouseEmCima.falhasContraste, 'botão principal com o mouse em cima').toEqual([]);
  await editar.click();
  const noEditor = await page.evaluate(medirLegibilidade);
  expect(noEditor.falhasTamanho, 'editor: tamanho').toEqual([]);
  expect(noEditor.falhasContraste, 'editor: contraste').toEqual([]);
  await folha.getByRole('button', { name: 'Cancelar' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const noCelular = await page.evaluate(medirLegibilidade);
  expect(noCelular.falhasTamanho, 'celular: tamanho').toEqual([]);
  expect(noCelular.falhasContraste, 'celular: contraste').toEqual([]);
});

test('em 1280 px o índice fica à esquerda e os artigos em duas colunas, sem passar da folha', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const projeto = await criarProjeto(request, textoComTitulos);
  const folha = await abrir(page, projeto.id);
  await expect(folha.getByRole('navigation', { name: 'Seções da diretriz' })).toBeVisible();
  const [primeiro, ultimo] = await folha.locator('.dz-artigo').evaluateAll(els => [els[0], els[els.length - 1]].map(el => el.getBoundingClientRect().left));
  expect(ultimo).toBeGreaterThan(primeiro + 100);
  expect(await foraDaFolha(folha)).toEqual([]);
});

test('abaixo de 1100 px o selo desce para baixo da manchete, os artigos ficam numa coluna e o índice some', async ({ page, request }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const projeto = await criarProjeto(request, textoComTitulos);
  const folha = await abrir(page, projeto.id);
  await expect(folha.locator('.dz-artigo')).toHaveCount(4);
  await expect(folha.getByRole('navigation', { name: 'Seções da diretriz' })).toBeHidden();
  const manchete = await folha.locator('.dz-lide').boundingBox();
  const selo = await folha.locator('.dz-selo').boundingBox();
  expect(selo!.y).toBeGreaterThan(manchete!.y + manchete!.height);
  const [primeiro, segundo] = await folha.locator('.dz-artigo').evaluateAll(els => els.slice(0, 2).map(el => el.getBoundingClientRect()));
  expect(Math.abs(segundo.left - primeiro.left)).toBeLessThan(2);
  expect(segundo.top).toBeGreaterThan(primeiro.bottom - 1);
  expect(await foraDaFolha(folha)).toEqual([]);
});

test('no celular (390 px) tudo cabe na folha, em uma coluna', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const projeto = await criarProjeto(request, textoComTitulos);
  const folha = await abrir(page, projeto.id);
  await expect(folha.locator('.dz-artigo')).toHaveCount(4);
  const caixa = await folha.boundingBox();
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(390);
  expect(await foraDaFolha(folha)).toEqual([]);
});

test('a Visão geral mostra só o resumo da diretriz e o link leva à aba, com o destaque de chegada', async ({ page, request }) => {
  const projeto = await criarProjeto(request, textoComTitulos);
  await page.goto(`/#project/${projeto.id}`);
  await page.getByRole('tab', { name: 'Visão geral' }).click();
  const resumo = page.getByRole('region', { name: 'Resumo da diretriz do projeto' });
  await expect(resumo.getByText('Diretriz do projeto', { exact: true })).toBeVisible();
  await expect(resumo.getByText('Vender livros usados.', { exact: true })).toBeVisible();
  await expect(resumo.getByText('Entregar em dois dias.')).toHaveCount(0);
  await expect(resumo.getByText(/^Versão 1 · vigente desde \d{1,2} de .+ de \d{4}$/)).toBeVisible();
  await expect(resumo.getByText('Uma IA atualizou: confira')).toHaveCount(0);
  const selo = resumo.getByRole('img', { name: /Selo da diretriz: 1 versão/ });
  expect(await selo.evaluate(el => el.getBoundingClientRect().width)).toBe(64);
  await expect(page.getByRole('button', { name: 'Editar diretriz' })).toHaveCount(0);
  await resumo.getByRole('button', { name: 'Abrir a diretriz' }).click();
  const folha = page.getByRole('region', { name: 'Diretriz do projeto' });
  await expect(page.getByRole('tab', { name: 'Diretriz', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(folha).toHaveClass(/axon-chegou/);
  await expect(folha.locator('.dz-lide')).toHaveText('Vender livros usados.');
  await expect(page.getByRole('heading', { name: 'Resumo da diretriz do projeto' })).toHaveCount(0);
});

test('o resumo da Visão geral avisa, em brasa, que uma IA atualizou e ainda não foi conferido', async ({ page, request }) => {
  const id = await criarAtualizacao(request);
  await page.goto(`/#project/${id}`);
  await page.getByRole('tab', { name: 'Visão geral' }).click();
  const resumo = page.getByRole('region', { name: 'Resumo da diretriz do projeto' });
  const aviso = resumo.getByText('Uma IA atualizou: confira');
  await expect(aviso).toBeVisible();
  expect(await aviso.evaluate(el => getComputedStyle(el).color)).toBe('rgb(246, 178, 142)');
  await expect(resumo.getByText(/^Versão 2 · vigente desde/)).toBeVisible();
  const medida = await page.evaluate(medirLegibilidade);
  expect(medida.falhasTamanho).toEqual([]);
  expect(medida.falhasContraste).toEqual([]);
});
