import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { WorkspaceStore } from '../server/store';
import { medirLegibilidade } from './apoio/legibilidade';

/**
 * Pente fino de UX, segunda entrega (itens 4.4, 4.5, 6.1, 9.2, 10.1, 11.1 a 11.3, 12.3, 12.6 a 12.9):
 * cada conserto de comportamento clica e confere; cor e margem são lidas do que o navegador desenhou.
 */
const HEADERS = { 'X-Workspace-Client': 'local' };
const unico = () => randomUUID().slice(0, 8);

async function criarProjeto(request: APIRequestContext, nome: string, extra: Record<string, unknown> = {}) {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name: nome, objective: 'Manter a memória do trabalho entre as IAs.', ...extra } });
  expect(res.status()).toBe(201);
  return await res.json() as { id: string; name: string };
}

async function tarefaConcluida(request: APIRequestContext, projectId: string, titulo: string, agente = 'Claude') {
  const tarefa = await (await request.post(`/api/projects/${projectId}/tasks`, { headers: HEADERS, data: { title: titulo } })).json();
  expect((await request.post(`/api/projects/${projectId}/tasks/${tarefa.id}/claim`, { headers: HEADERS, data: { agent: agente, expectedVersion: 0 } })).ok()).toBeTruthy();
  const atual = await (await request.get(`/api/projects/${projectId}`, { headers: HEADERS })).json();
  const res = await request.post(`/api/projects/${projectId}/finalize`, { headers: HEADERS, data: {
    agent: agente, expectedRevision: atual.project.revision, idempotencyKey: randomUUID(), summary: 'Feito.', humanSummary: 'Feito para o teste.',
    nextStep: 'Seguir.', taskId: tarefa.id, taskTransition: { kind: 'declare_done' },
  } });
  expect(res.ok(), `concluir "${titulo}"`).toBeTruthy();
  return tarefa.id as string;
}

function comBancoDeTeste<T>(usar: (store: WorkspaceStore) => T): T {
  const arquivo = process.env.AXON_E2E_DB_PATH;
  expect(arquivo, 'O Playwright precisa configurar seu banco temporário').toBeTruthy();
  const store = new WorkspaceStore(arquivo!);
  try { return usar(store); } finally { store.close(); }
}

async function abrirProjeto(page: Page, id: string, aba = 'Visão geral') {
  await page.goto(`/#project/${id}`);
  await page.getByRole('tab', { name: aba, exact: true }).click();
}

const cor = (loc: Locator, propriedade: string) => loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), propriedade);

/** "rgb(r, g, b)" ou "rgba(r, g, b, a)" em três números. */
function canais(texto: string): [number, number, number] {
  const [r, g, b] = (texto.match(/[\d.]+/g) ?? []).map(Number);
  return [r!, g!, b!];
}

/** Cinza de grafite: os três canais quase iguais (nada de azul-marinho, verde ou âmbar). */
function ehGrafite(texto: string, tolerancia = 12) {
  const [r, g, b] = canais(texto);
  return Math.max(r, g, b) - Math.min(r, g, b) <= tolerancia;
}

test.describe('4.4 formulários da Visão geral, um por vez', () => {
  test('abrir o bloqueio fecha os detalhes de uma tarefa, rola até o formulário e foca o primeiro campo; e vice-versa', async ({ page, request }) => {
    const projeto = await criarProjeto(request, `Um por vez ${unico()}`);
    await tarefaConcluida(request, projeto.id, 'Primeira entrega');
    await tarefaConcluida(request, projeto.id, 'Segunda entrega');
    await abrirProjeto(page, projeto.id);
    const primeira = page.locator('article.task').filter({ hasText: 'Primeira entrega' });
    const segunda = page.locator('article.task').filter({ hasText: 'Segunda entrega' });

    await primeira.getByRole('button', { name: 'Ver detalhes', exact: true }).click();
    await expect(primeira.getByRole('button', { name: 'Recolher detalhes', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Abrir bloqueio', exact: true }).click();
    const titulo = page.getByLabel('Título do bloqueio');
    await expect(titulo).toBeVisible();
    await expect(titulo).toBeFocused();
    await expect(titulo).toBeInViewport();
    await expect(page.locator('form[data-chegada="aberto:bloqueio"]')).toHaveClass(/axon-chegou/);
    await expect(primeira.getByRole('button', { name: 'Ver detalhes', exact: true })).toBeVisible();

    await segunda.getByRole('button', { name: 'Ver detalhes', exact: true }).click();
    await expect(segunda.getByRole('button', { name: 'Recolher detalhes', exact: true })).toBeVisible();
    await expect(page.getByLabel('Título do bloqueio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Abrir bloqueio', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recolher detalhes', exact: true })).toHaveCount(1);

    await segunda.getByRole('button', { name: 'Recolher detalhes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Recolher detalhes', exact: true })).toHaveCount(0);
  });

  test('cancelar o formulário de bloqueio o fecha', async ({ page, request }) => {
    const projeto = await criarProjeto(request, `Cancelar ${unico()}`);
    await abrirProjeto(page, projeto.id);
    await page.getByRole('button', { name: 'Abrir bloqueio', exact: true }).click();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByLabel('Título do bloqueio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Abrir bloqueio', exact: true })).toBeVisible();
  });
});

test('4.5 "Reabrir tarefa" é texto; o contorno só aparece com o foco do teclado', async ({ page, request }) => {
  const projeto = await criarProjeto(request, `Reabrir ${unico()}`);
  await tarefaConcluida(request, projeto.id, 'Entrega fechada');
  await abrirProjeto(page, projeto.id);
  await page.getByLabel('Nome do agente').fill('Claude');
  const botao = page.getByRole('button', { name: 'Reabrir tarefa', exact: true });
  await expect(botao).toBeEnabled();
  const parado = await botao.evaluate(el => { const s = getComputedStyle(el); return { contorno: s.outlineStyle, borda: s.borderTopColor, fundo: s.backgroundColor }; });
  expect(parado).toEqual({ contorno: 'none', borda: 'rgba(0, 0, 0, 0)', fundo: 'rgba(0, 0, 0, 0)' });
  for (let i = 0; i < 80 && !(await botao.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(botao).toBeFocused();
  expect(await cor(botao, 'outline-style')).toBe('solid');
  expect(parseFloat(await cor(botao, 'outline-width'))).toBeGreaterThanOrEqual(2);
});

test.describe('6.1 Regras', () => {
  test('a frase do dono só aparece quando diz algo além do título, e a lixeira é um ícone com dica', async ({ page, request }) => {
    const projeto = await criarProjeto(request, `Regras ${unico()}`);
    comBancoDeTeste(store => {
      store.registrarLicao(projeto.id, { tipo: 'regra', texto: 'Preservar a página de preços', fraseDoDono: 'preservar a pagina de precos.', agent: 'Claude' });
      store.registrarLicao(projeto.id, { tipo: 'regra', texto: 'Congelar o checkout', fraseDoDono: 'Não mexer no checkout durante a promoção de fim de ano.', agent: 'Claude' });
    });
    await page.setViewportSize({ width: 1920, height: 1000 });
    await abrirProjeto(page, projeto.id, 'Regras');
    const regras = page.getByRole('tabpanel', { name: 'Regras', exact: true });
    const repetida = regras.locator('li.regras-orientacao').filter({ hasText: 'Preservar a página de preços' });
    const diferente = regras.locator('li.regras-orientacao').filter({ hasText: 'Congelar o checkout' });
    await expect(repetida.locator('blockquote')).toHaveCount(0);
    await expect(diferente.locator('blockquote')).toContainText('Não mexer no checkout durante a promoção de fim de ano.');
    await expect(diferente.locator('blockquote')).toContainText('Dita por você');

    const lixeira = repetida.getByRole('button', { name: 'Mandar para a lixeira: Preservar a página de preços' });
    await expect(lixeira).toHaveAttribute('title', 'Mandar para a lixeira');
    await expect(lixeira.locator('svg')).toHaveCount(1);
    expect((await lixeira.innerText()).trim()).toBe('');
    await expect(repetida.getByRole('button', { name: /^Corrigir/ })).toHaveText('Corrigir');

    const largura = await page.locator('.regras').evaluate(el => el.getBoundingClientRect().width);
    expect(largura, 'a aba usa a largura da tela, sem parar em 1280 px').toBeGreaterThan(1300);

    await lixeira.click();
    await expect(regras.getByRole('status').filter({ hasText: 'Item enviado para a lixeira.' })).toBeVisible();
    const medida = await page.evaluate(medirLegibilidade);
    expect(medida.falhasTamanho).toEqual([]);
    expect(medida.falhasContraste).toEqual([]);
  });
});

test.describe('9.2 Retomar e Conectar IA em grafite', () => {
  test('a caixa de copiar, o aviso e a prévia são grafite', async ({ page, request }) => {
    const projeto = await criarProjeto(request, `Retomar ${unico()}`);
    await abrirProjeto(page, projeto.id, 'Retomar');
    const caixa = page.locator('.copiar-para-outra-ia');
    await expect(caixa).toBeVisible();
    for (const [seletor, propriedade] of [
      ['.copiar-para-outra-ia', 'background-color'], ['.copiar-para-outra-ia', 'border-top-color'],
      ['.copiar-aviso-desativado', 'background-color'], ['.copiar-aviso-desativado', 'border-top-color'], ['.copiar-aviso-desativado', 'color'],
      ['.copiar-previa-texto', 'background-color'], ['.copiar-previa-texto', 'border-top-color'],
    ] as const) {
      expect(ehGrafite(await cor(page.locator(seletor).first(), propriedade), propriedade === 'color' ? 20 : 12), `${seletor} ${propriedade}`).toBe(true);
    }
    const medida = await page.evaluate(medirLegibilidade);
    expect(medida.falhasContraste).toEqual([]);
  });

  test('os blocos de código do Gerador de conectores são grafite', async ({ page }) => {
    await page.goto('/#connect');
    await page.getByRole('button', { name: 'Gerador de Conectores & Protocolo' }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    const aba = dialogo.getByRole('button', { name: /Cursor/ }).first();
    if (await aba.count()) await aba.click();
    const bloco = dialogo.locator('.code-snippet-box').first();
    await expect(bloco).toBeVisible();
    for (const [seletor, propriedade] of [
      ['.code-snippet-box', 'background-color'], ['.code-snippet-box', 'border-top-color'],
      ['.connector-step-box', 'background-color'], ['.connector-step-box', 'border-top-color'], ['.snippet-copy-btn', 'background-color'],
    ] as const) {
      expect(ehGrafite(await cor(dialogo.locator(seletor).first(), propriedade)), `${seletor} ${propriedade}`).toBe(true);
    }
  });
});

test('10.1 Retrospectiva: o nome inteiro da IA fica no title', async ({ page, request }) => {
  const projeto = await criarProjeto(request, `Retro ${unico()}`);
  const nomeLongo = 'claude-opus-5.5-orquestrador-de-frentes-paralelas';
  await tarefaConcluida(request, projeto.id, 'Entrega do orquestrador', nomeLongo);
  await abrirProjeto(page, projeto.id, 'Retrospectiva');
  const nome = page.locator('.retro-pessoa-nome', { hasText: nomeLongo }).first();
  await expect(nome).toBeVisible();
  await expect(nome).toHaveAttribute('title', nomeLongo);
});

test.describe('11 Lista de projetos, Tear e barra lateral', () => {
  test('11.1 clicar no nome ou no trilho do Tear leva ao projeto e acende o nome dele', async ({ page, request }) => {
    const projeto = await criarProjeto(request, `Tear clicável ${unico()}`);
    await page.goto('/#projects');
    const nome = page.locator('a.tear-nome', { hasText: projeto.name });
    await expect(nome).toBeVisible();
    await expect(nome).toHaveAttribute('href', `#project/${projeto.id}`);
    await nome.click();
    await expect(page).toHaveURL(new RegExp(`#project/${projeto.id}$`));
    await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toHaveClass(/axon-chegou/);

    await page.goto('/#projects');
    const trilho = page.locator(`a.tear-trilho-link[href="#project/${projeto.id}"]`);
    await expect(trilho).toBeVisible();
    await trilho.hover();
    await expect(trilho).toHaveClass(/tear-trilho-link-realce/);
    await expect(page.locator('li.tear-projeto-realce')).toContainText(projeto.name);
    await trilho.click();
    await expect(page).toHaveURL(new RegExp(`#project/${projeto.id}$`));
    await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toHaveClass(/axon-chegou/);
  });

  test('11.2 a barra lateral segue a ordem da lista (favoritos primeiro), com reticências e o nome inteiro no title', async ({ page, request }) => {
    const sufixo = unico();
    const antigo = await criarProjeto(request, `Antigo ${sufixo}`);
    const longo = await criarProjeto(request, `Projeto com um nome tão comprido que não cabe na barra lateral de jeito nenhum ${sufixo}`);
    await page.goto('/#projects');
    await expect(page.locator('.library-project h3').first()).toBeVisible();
    const daLista = await page.locator('.library-project h3').allInnerTexts();
    const daBarra = async () => page.locator('.recent-projects > a .nome-lateral').allInnerTexts();
    expect(await daBarra()).toEqual(daLista.slice(0, 5));

    const link = page.locator('.recent-projects > a', { hasText: 'Projeto com um nome tão comprido' });
    await expect(link).toHaveAttribute('title', longo.name);
    const nome = link.locator('.nome-lateral');
    expect(await cor(nome, 'text-overflow')).toBe('ellipsis');
    expect(await nome.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);

    await page.getByRole('button', { name: `Favoritar ${antigo.name}` }).click();
    await expect.poll(daBarra).toEqual((await page.locator('.library-project h3').allInnerTexts()).slice(0, 5));
    expect((await daBarra())[0]).toBe(antigo.name);
  });

  test('11.3 caminho com barras dobradas aparece normal e a coluna se chama Versão', async ({ page, request }) => {
    const barra = String.fromCharCode(92);
    const dobrado = ['C:', 'Users', 'Ana', 'MeuJogo'].join(barra + barra);
    const projeto = await criarProjeto(request, `Caminho ${unico()}`, { workspacePath: dobrado });
    await page.goto('/#projects');
    const linha = page.locator('.library-project', { hasText: projeto.name });
    await expect(linha.locator('.project-location')).toHaveText(['C:', 'Users', 'Ana', 'MeuJogo'].join(barra));
    await expect(page.locator('.library-columns')).toContainText('VERSÃO');
    await expect(page.locator('.library-columns')).not.toContainText('SALVO NESTE COMPUTADOR');
    await page.getByRole('combobox', { name: 'Ordenar projetos' }).selectOption('recent');
  });
});

test.describe('12 Modais, Conexões, avisos e foco', () => {
  test('12.3 Excluir projeto: campo vazio com a dica e a lista completa do que será removido', async ({ page, request }) => {
    const projeto = await criarProjeto(request, `Excluir ${unico()}`);
    await tarefaConcluida(request, projeto.id, 'Uma tarefa');
    await page.goto(`/#project/${projeto.id}`);
    await page.getByRole('button', { name: 'Excluir projeto', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Excluir projeto', exact: true });
    const campo = dialogo.getByLabel('Digite o nome do projeto');
    await expect(campo).toHaveValue('');
    await expect(campo).toHaveAttribute('placeholder', `Digite: ${projeto.name}`);
    const rotulos = ['Tarefas', 'Checkpoints', 'Mensagens', 'Itens de backlog', 'Cartões do Quadro', 'Documentos da Biblioteca', 'Decisões', 'Bloqueios', 'Regras, verificações e erros', 'Versões da diretriz'];
    for (const rotulo of rotulos) await expect(dialogo.locator('dt', { hasText: new RegExp(`^${rotulo}$`) })).toBeVisible();
    await expect(dialogo.locator('dt', { hasText: /^Tarefas$/ }).locator('xpath=following-sibling::dd')).toHaveText('1');
    await expect(dialogo.locator('dd', { hasText: '–' })).toHaveCount(0);
    const colunas = await dialogo.locator('.delete-summary dl').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(colunas).toBe(4);
    await expect(dialogo.getByRole('button', { name: 'Excluir projeto', exact: true })).toBeDisabled();
    const medida = await page.evaluate(medirLegibilidade);
    expect(medida.falhasTamanho).toEqual([]);
    expect(medida.falhasContraste).toEqual([]);
  });

  test('12.6 Exportar: o aviso de pacote reduzido não encosta no rótulo do campo', async ({ page, request }) => {
    const projeto = await criarProjeto(request, `Exportar ${unico()}`);
    await page.route(`**/api/projects/${projeto.id}/handoff`, async rota => {
      const resposta = await rota.fetch();
      await rota.fulfill({ response: resposta, json: { ...(await resposta.json()), truncated: true } });
    });
    await page.goto(`/#project/${projeto.id}`);
    await page.getByRole('button', { name: /^Exportar/ }).first().click();
    const dialogo = page.getByRole('dialog', { name: 'Exportar contexto' });
    const aviso = dialogo.locator('.notice');
    await expect(aviso).toBeVisible();
    const rotulo = dialogo.locator('.export-label');
    const [a, r] = await Promise.all([aviso.boundingBox(), rotulo.boundingBox()]);
    expect(r!.y - (a!.y + a!.height)).toBeGreaterThanOrEqual(15.5);
  });

  test('12.7 Conexões: selo sem cara de botão, Copiar no JSON e seta no link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/#connect');
    const selo = page.locator('.selo-de-estado').first();
    await expect(selo).toBeVisible();
    const estilo = await selo.evaluate(el => { const s = getComputedStyle(el); return { borda: s.borderTopWidth, fundo: s.backgroundColor }; });
    expect(estilo).toEqual({ borda: '0px', fundo: 'rgba(0, 0, 0, 0)' });
    await expect(page.locator('.status-tag')).toHaveCount(0);
    await expect(page.locator('.text-link', { hasText: 'Escolher projeto' }).locator('svg.lucide-arrow-right')).toHaveCount(1);
    await expect(page.locator('.text-link', { hasText: 'Escolher projeto' }).locator('svg.lucide-arrow-up-right')).toHaveCount(0);

    await page.locator('.setup-panel').getByRole('button', { name: 'Copiar', exact: true }).click();
    await expect(page.locator('.setup-panel').getByRole('button', { name: 'Copiado!' })).toBeVisible();
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copiado)).toEqual(JSON.parse(await page.locator('.setup-panel pre').innerText()));
    expect(JSON.parse(copiado).mcpServers.axon.command).toBeTruthy();
  });

  test('12.8 a confirmação não é verde: ícone em brasa e moldura em grafite', async ({ page, request }) => {
    const projeto = await criarProjeto(request, `Aviso ${unico()}`);
    await abrirProjeto(page, projeto.id);
    await page.getByLabel('Título da tarefa').fill('Tarefa do aviso');
    await page.getByRole('button', { name: 'Adicionar tarefa', exact: true }).click();
    const aviso = page.locator('.feedback-toast');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('Tarefa adicionada');
    expect(ehGrafite(await cor(aviso, 'background-color'))).toBe(true);
    expect(ehGrafite(await cor(aviso, 'border-top-color'))).toBe(true);
    for (const propriedade of ['color', 'border-top-color']) {
      const [r, g, b] = canais(await cor(aviso.locator('.feedback-icon'), propriedade));
      expect(r, `ícone ${propriedade}`).toBeGreaterThan(g);
      expect(g, `ícone ${propriedade}`).toBeGreaterThanOrEqual(b);
    }
  });

  test('12.9 o primeiro Tab é "Pular para o conteúdo", que leva o foco ao conteúdo sem mudar a rota', async ({ page }) => {
    await page.goto('/#connect');
    await expect(page.getByRole('heading', { name: 'Conexões', level: 1 })).toBeVisible();
    await page.keyboard.press('Tab');
    const link = page.getByRole('link', { name: 'Pular para o conteúdo' });
    await expect(link).toBeFocused();
    const caixa = await link.boundingBox();
    expect(caixa!.y).toBeGreaterThanOrEqual(0);
    expect(caixa!.x).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await expect(page).toHaveURL(/#connect$/);
  });
});
