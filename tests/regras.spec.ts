import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { WorkspaceStore } from '../server/store';
import type { Licao } from '../shared/licoes';
import { medirLegibilidade } from './apoio/legibilidade';

const headers = { 'X-Workspace-Client': 'local' };

async function criarProjeto(request: APIRequestContext) {
  const resposta = await request.post('/api/projects', {
    headers, data: { name: `Vitrine ${randomUUID().slice(0, 8)}`, objective: 'Publicar e conferir a vitrine da loja.' },
  });
  expect(resposta.status()).toBe(201);
  return await resposta.json() as { id: string; name: string };
}

function comBancoDeTeste<T>(usar: (store: WorkspaceStore) => T): T {
  const arquivo = process.env.AXON_E2E_DB_PATH;
  expect(arquivo, 'O Playwright precisa configurar seu banco temporário').toBeTruthy();
  const store = new WorkspaceStore(arquivo!);
  try { return usar(store); } finally { store.close(); }
}

async function abrir(page: Page, projeto: { id: string; name: string }) {
  await page.goto(`/#project/${projeto.id}`);
  await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toBeVisible();
  const aba = page.getByRole('tab', { name: 'Regras', exact: true });
  await aba.click();
  await expect(aba).toHaveAttribute('aria-selected', 'true');
  return page.getByRole('tabpanel', { name: 'Regras', exact: true });
}

async function historico(request: APIRequestContext, projectId: string): Promise<Licao[]> {
  const resposta = await request.get(`/api/projects/${projectId}/licoes?incluirAposentadas=true`);
  expect(resposta.status()).toBe(200);
  const licoes: Licao[] = await resposta.json();
  return licoes.filter(licao => licao.projectId === projectId);
}

test('lista regras, separa erros e mostra verificações por momento sem depender da rota de falhas', async ({ page, request }, info) => {
  const projeto = await criarProjeto(request);
  const geral = comBancoDeTeste(store => {
    store.registrarLicao(projeto.id, { tipo: 'regra', texto: 'Preservar a página de preços', fraseDoDono: 'Mantenha a página de preços como está.', agent: 'Claude' });
    store.registrarLicao(projeto.id, { texto: 'A vitrine antiga tinha links para produtos indisponíveis.', linhaCurta: 'Revisar links da vitrine', agent: 'Gemini' });
    store.registrarLicao(projeto.id, { tipo: 'verificacao', texto: 'Abrir a vitrine publicada', fraseDoDono: 'Abrir a vitrine publicada', momento: 'antes_de_subir', agent: 'Dono' });
    store.registrarLicao(projeto.id, { tipo: 'verificacao', texto: 'Conferir o formulário de contato', fraseDoDono: 'Conferir o formulário de contato', momento: 'antes_de_pronto', agent: 'Dono' });
    store.registrarLicao(projeto.id, { tipo: 'verificacao', texto: 'Revisar os arquivos alterados', fraseDoDono: 'Revisar os arquivos alterados', momento: 'antes_de_commit', agent: 'Dono' });
    return store.registrarLicao(null, { texto: 'O terminal cortou os acentos na importação.', linhaCurta: 'Conferir acentos na importação', agent: 'Codex' });
  });
  const falhas = `**/api/projects/${projeto.id}/verificacoes/falhas`;
  await page.route(falhas, route => route.fulfill({ status: 404, json: { error: { code: 'route_not_found' } } }));
  try {
    const painel = await abrir(page, projeto);
    const regras = painel.getByRole('region', { name: 'Suas regras' });
    await expect(regras.getByText('Preservar a página de preços')).toBeVisible();
    await expect(regras.getByRole('button', { name: 'Mandar para a lixeira: Preservar a página de preços' })).toBeEnabled();
    await expect(regras.getByText('Preservar a página de preços')).toHaveCSS('font-size', '16px');
    await expect(regras.getByText('Mantenha a página de preços como está.')).toBeVisible();
    await expect(regras.getByText(/Anotada por Claude em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    const erros = painel.getByRole('region', { name: 'Erros a não repetir' });
    const locais = erros.getByRole('region', { name: 'Neste projeto' });
    const gerais = erros.getByRole('region', { name: 'Em todos os projetos' });
    await expect(locais.getByText('Revisar links da vitrine')).toBeVisible();
    // "Em todos os projetos" começa recolhido, com a contagem à vista.
    await expect(gerais.getByText('Conferir acentos na importação')).toBeHidden();
    await expect(gerais.getByRole('button', { name: /^Em todos os projetos/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(gerais.locator('.regras-grupo-contagem')).toHaveText('1');
    await gerais.getByRole('button', { name: /^Em todos os projetos/ }).click();
    await expect(gerais.getByText('Conferir acentos na importação')).toBeVisible();
    await expect(locais.getByText('Conferir acentos na importação')).toHaveCount(0);
    await expect(gerais.getByText('Revisar links da vitrine')).toHaveCount(0);
    const textoCompleto = locais.getByText('A vitrine antiga tinha links para produtos indisponíveis.');
    await expect(textoCompleto).toBeHidden();
    await locais.getByText('Revisar links da vitrine').click();
    await expect(textoCompleto).toBeVisible();
    await expect(locais.getByRole('button', { name: /^Mandar para a lixeira/ })).toBeEnabled();
    await expect(gerais.getByRole('button', { name: /^Mandar para a lixeira/ })).toHaveCount(0);

    const verificacoes = painel.getByRole('region', { name: 'Verificações' });
    await expect(verificacoes.getByRole('heading', { level: 4 })).toHaveText(['Antes de subir', 'Antes de dizer pronto', 'Antes de commit ou junção']);
    const antesDeSubir = verificacoes.getByRole('region', { name: 'Antes de subir' });
    await expect(antesDeSubir).toContainText('Abrir a vitrine publicada');
    await expect(antesDeSubir.getByRole('button', { name: /^Mandar para a lixeira/ })).toBeEnabled();
    await expect(verificacoes.getByRole('region', { name: 'Antes de dizer pronto' })).toContainText('Conferir o formulário de contato');
    await expect(verificacoes.getByRole('region', { name: 'Antes de commit ou junção' })).toContainText('Revisar os arquivos alterados');
    await expect(painel.getByRole('alert')).toHaveCount(0);

    await page.unroute(falhas);
    const primeira = (await historico(request, projeto.id)).find(item => item.momento === 'antes_de_subir')!;
    await page.route(falhas, route => route.fulfill({ json: [{
      verificacaoId: primeira.id, quantas: 2, ultimaEm: '2026-11-20T12:00:00Z',
      ultimoCheckpointId: randomUUID(), ultimoDetalhe: 'A vitrine abriu com o preço antigo.',
    }] }));
    await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
    await page.getByRole('tab', { name: 'Regras', exact: true }).click();
    const subir = verificacoes.getByRole('region', { name: 'Antes de subir' });
    await expect(subir.getByText('Falhou 2 vezes · Última em 20/11/2026')).toBeVisible();
    await expect(subir.getByText('A vitrine abriu com o preço antigo.')).toBeVisible();
    await expect(verificacoes.getByRole('region', { name: 'Antes de dizer pronto' }).getByText('Falhou', { exact: false })).toHaveCount(0);
    await locais.getByText('Revisar links da vitrine').click();
    await page.screenshot({ path: info.outputPath('aba-regras.png'), fullPage: true, animations: 'disabled' });
  } finally {
    comBancoDeTeste(store => store.aposentarLicao(geral.id, { agent: 'Dono', motivo: 'Fim do cenário' }));
  }
});

test('cria, corrige e desfaz uma regra guardando o histórico e o motivo', async ({ page, request }) => {
  const projeto = await criarProjeto(request);
  const painel = await abrir(page, projeto);
  const suasRegras = painel.getByRole('region', { name: 'Suas regras' });
  const novaRegra = suasRegras.getByRole('button', { name: 'Nova regra' });
  await novaRegra.click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toHaveAccessibleName('Nova regra');
  await dialogo.getByLabel('Texto da regra').fill('Preservar a vitrine');
  await dialogo.getByRole('button', { name: 'Salvar regra' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(suasRegras.getByText('Preservar a vitrine', { exact: true })).toBeVisible();
  await expect(suasRegras.getByText(/Dita por você/)).toBeVisible();

  await suasRegras.getByRole('button', { name: /^Corrigir/ }).click();
  await expect(dialogo.getByLabel('Texto da regra')).toHaveValue('Preservar a vitrine');
  await dialogo.getByLabel('Texto da regra').fill('Preservar a vitrine e a página de preços');
  await dialogo.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(suasRegras.getByText('Preservar a vitrine', { exact: true })).toHaveCount(0);
  await expect(suasRegras.getByText('Preservar a vitrine e a página de preços', { exact: true })).toBeVisible();

  await suasRegras.getByRole('button', { name: /^Aposentar regra/ }).click();
  await expect(dialogo).toHaveAccessibleName('Aposentar regra');
  await dialogo.getByLabel('Motivo').fill('Vamos redesenhar a vitrine.');
  await dialogo.getByRole('button', { name: 'Aposentar regra' }).click();
  await expect(painel.getByRole('status').filter({ hasText: 'Regra aposentada.' })).toBeVisible();
  await expect(suasRegras.getByText('Você ainda não tem regras neste projeto.')).toBeVisible();

  const [anterior, corrigida] = await historico(request, projeto.id);
  expect(anterior).toMatchObject({ texto: 'Preservar a vitrine', fraseDoDono: 'Preservar a vitrine', origem: 'Dono' });
  expect(anterior.aposentadaEm).toBeTruthy();
  expect(corrigida).toMatchObject({ texto: 'Preservar a vitrine e a página de preços', substituiId: anterior.id, tipo: 'regra', origem: 'Dono' });
  expect(corrigida.aposentadaEm).toBeTruthy();
  expect(corrigida.motivoAposentadoria).toContain('pedido do dono: "Vamos redesenhar a vitrine."');
});

test('cria uma verificação antes de subir e aposenta um erro pelo motivo informado', async ({ page, request }) => {
  const projeto = await criarProjeto(request);
  comBancoDeTeste(store => store.registrarLicao(projeto.id, { texto: 'O serviço de e-mail já foi trocado.', agent: 'Claude' }));
  const painel = await abrir(page, projeto);
  await painel.getByRole('button', { name: 'Nova verificação' }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Quando conferir').selectOption({ label: 'Antes de subir' });
  await dialogo.getByLabel('O que precisa ser conferido').fill('Testar a página de preços');
  await dialogo.getByRole('button', { name: 'Salvar verificação' }).click();
  await expect(painel.getByRole('region', { name: 'Antes de subir' })).toContainText('Testar a página de preços');

  await painel.getByText('O serviço de e-mail já foi trocado.').click();
  await painel.getByRole('button', { name: /^Aposentar: O serviço de e-mail/ }).click();
  await dialogo.getByLabel('Motivo').fill('O serviço antigo saiu da loja.');
  await dialogo.getByRole('button', { name: 'Aposentar erro' }).click();
  await expect(painel.getByRole('region', { name: 'Neste projeto' })).toContainText('Nenhum erro anotado neste projeto.');

  const [erro, verificacao] = await historico(request, projeto.id);
  expect(erro.motivoAposentadoria).toContain('O serviço antigo saiu da loja.');
  expect(verificacao).toMatchObject({ tipo: 'verificacao', momento: 'antes_de_subir', fraseDoDono: 'Testar a página de preços', origem: 'Dono' });
});

test('mostra carregamento, avisa a falha e tenta de novo até chegar ao estado vazio', async ({ page, request }) => {
  const projeto = await criarProjeto(request);
  const rotaDasLicoes = `**/api/projects/${projeto.id}/licoes`;
  let liberar!: () => void;
  const espera = new Promise<void>(resolve => { liberar = resolve; });
  await page.route(rotaDasLicoes, async route => {
    await espera;
    await route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } });
  });
  const painel = await abrir(page, projeto);
  try {
    await expect(painel.getByRole('status').filter({ hasText: 'Buscando as orientações…' })).toBeVisible();
  } finally {
    liberar();
  }
  await expect(painel.getByRole('alert')).toContainText('Não foi possível abrir as regras agora.');
  await page.unroute(rotaDasLicoes);
  await painel.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(painel.getByText('Você ainda não tem regras neste projeto.')).toBeVisible();
  await expect(painel.getByText('Nenhum erro anotado neste projeto.')).toBeVisible();
  await painel.getByRole('button', { name: /^Em todos os projetos/ }).click();
  await expect(painel.getByText('Nenhum erro geral anotado.')).toBeVisible();
  await expect(painel.getByText('Nenhuma verificação para este momento.')).toHaveCount(3);
  await expect(painel.getByRole('alert')).toHaveCount(0);
});

test('traduz a recusa de uma correção e conserva o que foi digitado', async ({ page, request }) => {
  const projeto = await criarProjeto(request);
  comBancoDeTeste(store => {
    for (const texto of ['Conferir o preço', 'Conferir o estoque']) {
      store.registrarLicao(projeto.id, { tipo: 'regra', texto, fraseDoDono: texto, agent: 'Dono' });
    }
  });
  const painel = await abrir(page, projeto);
  await painel.getByRole('button', { name: 'Corrigir: Conferir o preço', exact: true }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Texto da regra').fill('Conferir o estoque');
  await dialogo.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(dialogo.getByRole('alert')).toContainText('Já existe uma orientação ativa com esse texto.');
  await expect(dialogo.getByLabel('Texto da regra')).toHaveValue('Conferir o estoque');
  expect(await historico(request, projeto.id)).toHaveLength(2);
});

test('é operável pelo teclado com foco visível e texto legível no tema escuro', async ({ page, request }) => {
  const projeto = await criarProjeto(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const painel = await abrir(page, projeto);
  const aba = page.getByRole('tab', { name: 'Regras', exact: true });
  const novaRegra = painel.getByRole('button', { name: 'Nova regra' });
  await expect(novaRegra).toBeVisible();
  await aba.focus();
  await page.keyboard.press('Tab');
  await expect(novaRegra).toBeFocused();
  await expect(novaRegra).toHaveCSS('outline-style', 'solid');
  await expect(novaRegra).toHaveCSS('outline-width', '2px');
  await page.keyboard.press('Enter');
  const dialogo = page.getByRole('dialog');
  const texto = dialogo.getByLabel('Texto da regra');
  await expect(texto).toBeFocused();
  await expect(texto).toHaveCSS('outline-style', 'solid');
  const dialogoLegivel = await page.evaluate(medirLegibilidade);
  expect(dialogoLegivel.falhasTamanho.filter(({ classe }) => classe.includes('regras'))).toEqual([]);
  expect(dialogoLegivel.falhasContraste.filter(({ classe }) => classe.includes('regras'))).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialogo).toHaveCount(0);
  await expect(novaRegra).toBeFocused();
  const medida = await page.evaluate(medirLegibilidade);
  expect(medida.totalTextos).toBeGreaterThan(25);
  expect(medida.falhasTamanho.filter(({ classe }) => classe.includes('regras'))).toEqual([]);
  expect(medida.falhasContraste.filter(({ classe }) => classe.includes('regras'))).toEqual([]);
});

test('manda uma orientação para a lixeira, restaura e apaga de vez com confirmação', async ({ page, request }) => {
  const projeto = await criarProjeto(request);
  const texto = 'Conferir o estoque novo';
  const regra = comBancoDeTeste(store => store.registrarLicao(projeto.id, {
    tipo: 'regra', texto, fraseDoDono: texto, agent: 'Dono',
  }));
  const painel = await abrir(page, projeto);
  const regras = painel.getByRole('region', { name: 'Suas regras' });
  const lixeira = painel.getByRole('region', { name: 'Lixeira' });
  await expect(lixeira.getByText('A lixeira está vazia')).toBeVisible();
  const mandar = regras.getByRole('button', { name: `Mandar para a lixeira: ${texto}` });
  await mandar.click();
  await expect(regras.getByText(texto, { exact: true })).toHaveCount(0);
  await expect(lixeira.getByText(texto, { exact: true })).toBeVisible();
  await lixeira.getByRole('button', { name: /^Restaurar/ }).click();
  await expect(mandar).toBeVisible();
  await expect(lixeira.getByText('A lixeira está vazia')).toBeVisible();

  await mandar.click();
  const apagar = lixeira.getByRole('button', { name: /^Apagar de vez/ });
  await apagar.click();
  const dialogo = page.getByRole('dialog', { name: 'Apagar de vez' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialogo).toHaveCount(0);
  await expect(apagar).toBeFocused();
  await apagar.click();
  await dialogo.getByRole('button', { name: 'Apagar de vez' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(lixeira.getByText('A lixeira está vazia')).toBeVisible();
  expect(comBancoDeTeste(store => store.listAuditLogs({ projectId: projeto.id }).find(item => item.action === 'purge_record')?.resourceId)).toBe(regra.id);
  expect(await historico(request, projeto.id)).toEqual([]);
});

test('"Em todos os projetos" começa recolhido, com a contagem à vista, e tem busca', async ({ page, request }) => {
  const projeto = await criarProjeto(request);
  const gerais = comBancoDeTeste(store => [
    store.registrarLicao(null, { texto: 'O terminal cortou os acentos na importação.', linhaCurta: 'Conferir acentos na importação', agent: 'Codex' }),
    store.registrarLicao(null, { texto: 'A senha apareceu num log de teste.', linhaCurta: 'Não logar senhas', agent: 'Codex' }),
    store.registrarLicao(null, { texto: 'O banco real foi tocado por engano.', linhaCurta: 'Não tocar no banco real', agent: 'Codex' }),
  ]);
  try {
    const painel = await abrir(page, projeto);
    const grupo = painel.getByRole('region', { name: 'Em todos os projetos' });
    const botao = grupo.getByRole('button', { name: /^Em todos os projetos/ });
    await expect(botao).toHaveAttribute('aria-expanded', 'false');
    await expect(grupo.locator('.regras-grupo-contagem')).toHaveText('3');
    await expect(grupo.getByText('Não logar senhas')).toBeHidden();
    await expect(grupo.getByRole('searchbox')).toHaveCount(0);

    await botao.click();
    await expect(botao).toHaveAttribute('aria-expanded', 'true');
    await expect(grupo.getByText('Não logar senhas')).toBeVisible();
    const busca = grupo.getByRole('searchbox', { name: 'Buscar nos erros de todos os projetos' });
    await busca.fill('SENHA');
    await expect(grupo.getByText('Não logar senhas')).toBeVisible();
    await expect(grupo.getByText('Não tocar no banco real')).toHaveCount(0);
    await expect(grupo.locator('.regras-grupo-contagem')).toHaveText('1 de 3');
    await busca.fill('zzz');
    await expect(grupo.getByText('Nenhum erro encontrado com essa busca.')).toBeVisible();
    await busca.fill('');
    await expect(grupo.locator('.regras-grupo-contagem')).toHaveText('3');
  } finally {
    comBancoDeTeste(store => { for (const licao of gerais) store.aposentarLicao(licao.id, { agent: 'Dono', motivo: 'Fim do cenário' }); });
  }
});
