import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { WorkspaceStore } from '../server/store';

// Regra do dono (22/11/2026): todo clique que leva a outro ponto da tela destaca o destino.
// Cada caminho abaixo clica de verdade, confere a classe de destaque, o foco (quando a tela deve movê-lo) e que o destino está à vista.

const HEADERS = { 'X-Workspace-Client': 'local' };
const DESTAQUE = /axon-chegou/;

async function ok<T>(resposta: Promise<{ ok(): boolean; json(): Promise<unknown>; text(): Promise<string> }>): Promise<T> {
  const r = await resposta;
  if (!r.ok()) throw new Error(`Preparação falhou: ${await r.text()}`);
  return (await r.json()) as T;
}

async function novoProjeto(request: APIRequestContext, nome = 'Chegada') {
  return ok<{ id: string; name: string }>(request.post('/api/projects', { headers: HEADERS, data: { name: `${nome} ${randomUUID().slice(0, 6)}`, objective: 'Conferir o destaque de chegada.' } }));
}

async function abrir(page: Page, projeto: { id: string; name: string }, aba: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/#project/${projeto.id}`);
  await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: new RegExp(`^${aba}`) }).click();
}

async function estaNaTela(page: Page, el: Locator) {
  const caixa = await el.boundingBox();
  const tela = page.viewportSize()!;
  expect(caixa, 'o destino precisa estar na tela').not.toBeNull();
  return caixa!.y >= -1 && caixa!.y + caixa!.height <= tela.height + 1 && caixa!.x >= -1 && caixa!.x + caixa!.width <= tela.width + 1;
}

async function aoVivo(page: Page, destino: Locator) {
  await expect(destino).toHaveClass(DESTAQUE);
  await expect.poll(() => estaNaTela(page, destino)).toBe(true);
}

async function focoDentro(destino: Locator) {
  await expect.poll(() => destino.evaluate(el => el === document.activeElement || el.contains(document.activeElement))).toBe(true);
}

function comBancoDeTeste<T>(usar: (store: WorkspaceStore) => T): T {
  const store = new WorkspaceStore(process.env.AXON_E2E_DB_PATH!);
  try { return usar(store); } finally { store.close(); }
}

test.describe('Relações: "Abrir na aba de origem"', () => {
  test('uma decisão proposta abre em Decisões, mostra o histórico se precisar, acende e recebe o foco', async ({ page, request }) => {
    const projeto = await novoProjeto(request);
    const decisao = await ok<{ id: string }>(request.post(`/api/projects/${projeto.id}/decisions`, { headers: HEADERS, data: { agent: 'Claude', title: 'Editor: negrito e itálico', body: 'Começar pelo básico.' } }));
    await abrir(page, projeto, 'Relações');
    await page.locator('.graph-node-card').filter({ hasText: 'Editor: negrito e itálico' }).click();

    await page.getByRole('button', { name: 'Abrir na aba de origem' }).click();

    await expect(page.getByRole('tab', { name: /^Decisões/ })).toHaveAttribute('aria-selected', 'true');
    const alvo = page.locator(`[data-chegada="decisao:${decisao.id}"]`);
    await aoVivo(page, alvo);
    await expect(alvo).toBeFocused();
    // O brilho é uma animação de verdade (a variável de cor de uma tela não pode ter ficado para trás).
    expect(await alvo.evaluate(el => getComputedStyle(el).animationName)).toBe('axon-achado');
    await expect(alvo).not.toHaveClass(DESTAQUE, { timeout: 4500 });
  });

  test('um documento abre aberto no leitor da Biblioteca, com o item ativo na lista', async ({ page, request }) => {
    const projeto = await novoProjeto(request);
    let alvoId = '';
    for (let i = 1; i <= 6; i += 1) {
      const c = await ok<{ item: { id: string } }>(request.post(`/api/projects/${projeto.id}/content`, { headers: HEADERS, data: { title: `Documento ${i}`, kind: 'note', body: `Corpo ${i}. `.repeat(30), createdBy: 'Gemini', sourceKind: 'agent_report' } }));
      if (i === 5) alvoId = c.item.id;
    }
    await abrir(page, projeto, 'Relações');
    await page.locator('.graph-node-card').filter({ hasText: 'Documento 5' }).click();

    await page.getByRole('button', { name: 'Abrir na aba de origem' }).click();

    await expect(page.getByRole('tab', { name: 'Biblioteca', exact: true })).toHaveAttribute('aria-selected', 'true');
    const leitor = page.locator(`.library-document[data-chegada="conteudo:${alvoId}"]`);
    await aoVivo(page, leitor);
    await expect(leitor).toBeFocused();
    await expect(leitor.getByRole('heading', { name: 'Documento 5' })).toBeVisible();
    expect(await estaNaTela(page, page.locator('.library-item.is-active'))).toBe(true);
  });

  test('uma tarefa acende na coluna de Tarefas', async ({ page, request }) => {
    const projeto = await novoProjeto(request);
    const tarefa = await ok<{ id: string }>(request.post(`/api/projects/${projeto.id}/tasks`, { headers: HEADERS, data: { title: 'Estruturar o modelo' } }));
    await abrir(page, projeto, 'Relações');
    await page.locator('.graph-node-card').filter({ hasText: 'Estruturar o modelo' }).click();

    await page.getByRole('button', { name: 'Abrir na aba de origem' }).click();

    await expect(page.getByRole('tab', { name: 'Visão geral', exact: true })).toHaveAttribute('aria-selected', 'true');
    const alvo = page.locator(`article.task[data-chegada="tarefa:${tarefa.id}"]`);
    await aoVivo(page, alvo);
    await expect(alvo).toBeFocused();
  });
});

test('Visão geral: "Ver propostas" acende o bloco de propostas e leva o foco para dentro dele', async ({ page, request }) => {
  const projeto = await novoProjeto(request);
  await ok(request.post(`/api/projects/${projeto.id}/approvals`, { headers: HEADERS, data: { agent: 'Gemini', kind: 'note', title: 'Ajuste de contraste', body: 'Trocar a cor do rótulo.', rationale: 'Cumprir o contraste mínimo.' } }));
  await abrir(page, projeto, 'Visão geral');

  await page.getByRole('button', { name: /^Ver propostas/ }).click();

  const bloco = page.locator('#fila-de-aprovacoes');
  await aoVivo(page, bloco);
  await focoDentro(bloco);
});

test.describe('Quadro', () => {
  async function cartoes(request: APIRequestContext, projectId: string, quantos: number, coluna: string) {
    const ids: string[] = [];
    for (let i = 1; i <= quantos; i += 1) {
      ids.push((await ok<{ id: string }>(request.post(`/api/projects/${projectId}/board/cards`, { headers: HEADERS, data: { actor: 'Gemini', title: `Cartão ${coluna} ${i}`, column: coluna } }))).id);
    }
    return ids;
  }

  test('"Novo cartão": o cartão criado rola até a vista e acende; o foco fica no campo para seguir escrevendo', async ({ page, request }) => {
    const projeto = await novoProjeto(request);
    await cartoes(request, projeto.id, 12, 'pending');
    await abrir(page, projeto, 'Quadro');
    await expect(page.getByRole('button', { name: 'Novo cartão em Pendente' })).toBeVisible();

    await page.getByRole('button', { name: 'Novo cartão em Pendente' }).click();
    const campo = page.getByLabel('Título do cartão em Pendente');
    await campo.fill('Cartão que acabou de nascer');
    await campo.press('Enter');

    const novo = page.locator('.quadro-cartao', { hasText: 'Cartão que acabou de nascer' });
    await expect(novo).toHaveClass(DESTAQUE);
    await expect.poll(async () => {
      const c = await novo.boundingBox();
      const col = await page.getByRole('region', { name: 'Pendente', exact: true }).boundingBox();
      const tela = page.viewportSize()!;
      return !!c && c.y >= 0 && c.y + c.height <= tela.height && !!col && c.y >= col.y - 1 && c.y + c.height <= col.y + col.height + 1;
    }).toBe(true);
    await expect(campo).toBeFocused();
  });

  test('"Mover para" no painel: ao fechar, o cartão aparece à vista na coluna nova e acende', async ({ page, request }) => {
    const projeto = await novoProjeto(request);
    const [id] = await cartoes(request, projeto.id, 1, 'pending');
    await abrir(page, projeto, 'Quadro');
    await page.locator(`.quadro-cartao[data-card-id="${id}"]`).click();
    const painel = page.getByRole('dialog', { name: /^Cartão:/ });
    await painel.getByLabel('Mover para').selectOption('done');
    await expect(painel.getByText('Completo', { exact: true }).first()).toBeVisible();

    await painel.getByRole('button', { name: 'Fechar cartão' }).click();

    const alvo = page.locator(`.quadro-cartao[data-card-id="${id}"]`);
    await aoVivo(page, alvo);
    await expect(page.getByRole('region', { name: 'Completo', exact: true }).locator(`[data-card-id="${id}"]`)).toHaveCount(1);
  });

  test('Alt + seta para a direita: o cartão movido acende na coluna nova e o foco fica nele', async ({ page, request }) => {
    const projeto = await novoProjeto(request);
    const [id] = await cartoes(request, projeto.id, 1, 'pending');
    await abrir(page, projeto, 'Quadro');
    const cartao = page.locator(`.quadro-cartao[data-card-id="${id}"]`);
    await cartao.focus();

    await page.keyboard.press('Alt+ArrowRight');

    await aoVivo(page, cartao);
    await expect(cartao).toBeFocused();
  });
});

test.describe('Regras', () => {
  async function abrirRegras(page: Page, request: APIRequestContext, quantas: number) {
    const projeto = await novoProjeto(request);
    comBancoDeTeste(store => {
      for (let i = 1; i <= quantas; i += 1) store.registrarLicao(projeto.id, { tipo: 'regra', texto: `Regra antiga ${i}`, fraseDoDono: `Regra antiga ${i}`, agent: 'Dono' });
    });
    await abrir(page, projeto, 'Regras');
    return page.getByRole('tabpanel', { name: 'Regras', exact: true });
  }

  test('"Salvar regra": a regra nova rola até a vista e acende', async ({ page, request }) => {
    const painel = await abrirRegras(page, request, 8);
    await painel.getByRole('button', { name: 'Nova regra' }).click();
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Texto da regra').fill('Nunca publicar sem testar');

    await dialogo.getByRole('button', { name: 'Salvar regra' }).click();

    const nova = painel.locator('li[data-chegada^="licao:"]', { hasText: 'Nunca publicar sem testar' });
    await aoVivo(page, nova);
  });

  test('"Mandar para a lixeira" avisa com "Desfazer" por 6 s e "Ver na lixeira" leva até ela', async ({ page, request }) => {
    const painel = await abrirRegras(page, request, 3);
    await painel.getByRole('button', { name: 'Mandar para a lixeira: Regra antiga 2' }).click();

    const aviso = painel.getByRole('group', { name: 'Item enviado para a lixeira' });
    await expect(aviso).toBeVisible();
    await aviso.getByRole('button', { name: 'Ver na lixeira' }).click();
    const lixeira = painel.locator('[data-chegada="regras-lixeira"]');
    await aoVivo(page, lixeira);
    await focoDentro(lixeira);
    await expect(aviso).toBeHidden({ timeout: 9000 });
  });

  test('"Desfazer" tira a regra da lixeira e ela volta acesa', async ({ page, request }) => {
    const painel = await abrirRegras(page, request, 3);
    await painel.getByRole('button', { name: 'Mandar para a lixeira: Regra antiga 2' }).click();

    await painel.getByRole('group', { name: 'Item enviado para a lixeira' }).getByRole('button', { name: 'Desfazer' }).click();

    await expect(painel.getByRole('status').filter({ hasText: 'Item restaurado.' })).toBeVisible();
    await aoVivo(page, painel.locator('li[data-chegada^="licao:"]', { hasText: 'Regra antiga 2' }));
  });

  test('o botão que aposenta a regra se chama "Aposentar regra", não "Desfazer"', async ({ page, request }) => {
    const painel = await abrirRegras(page, request, 1);
    await expect(painel.getByRole('button', { name: /^Aposentar regra/ })).toBeVisible();
    await expect(painel.getByRole('button', { name: /^Desfazer: Regra/ })).toHaveCount(0);
  });
});

test('Backlog: "Transformar em tarefa" acende a tarefa nova na coluna de Tarefas', async ({ page, request }) => {
  const projeto = await novoProjeto(request);
  await abrir(page, projeto, 'Backlog');
  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByLabel('Título da ideia').fill('Revisar mascaramento de segredos');
  await page.getByRole('button', { name: 'Capturar ideia', exact: true }).click();
  await page.getByRole('region', { name: 'Ideias em avaliação' }).getByRole('button', { name: 'Preparar ideia', exact: true }).click();

  await page.getByRole('region', { name: 'Prontos para virar tarefa' }).getByRole('button', { name: 'Transformar em tarefa', exact: true }).click();

  await aoVivo(page, page.locator('article.task[data-chegada^="tarefa:"]', { hasText: 'Revisar mascaramento de segredos' }));
});

test('Visão geral: "Adicionar tarefa" acende a tarefa nova e o aviso não cobre o campo', async ({ page, request }) => {
  const projeto = await novoProjeto(request);
  await abrir(page, projeto, 'Visão geral');
  await page.getByLabel('Título da tarefa').fill('Escrever o roteiro do vídeo');

  await page.getByRole('button', { name: 'Adicionar tarefa' }).click();

  await aoVivo(page, page.locator('article.task[data-chegada^="tarefa:"]', { hasText: 'Escrever o roteiro do vídeo' }));
  const aviso = page.locator('.feedback-toast');
  await expect(aviso).toBeVisible();
  const campo = await page.getByLabel('Título da tarefa').boundingBox();
  const caixaAviso = await aviso.boundingBox();
  const separados = !campo || !caixaAviso || caixaAviso.x + caixaAviso.width <= campo.x || caixaAviso.x >= campo.x + campo.width || caixaAviso.y + caixaAviso.height <= campo.y || caixaAviso.y >= campo.y + campo.height;
  expect(separados, 'o aviso não pode ficar em cima do campo de título da tarefa').toBe(true);
});

test('Biblioteca: clicar num documento da grade abre o leitor à vista, acende e mantém o item ativo na lista', async ({ page, request }) => {
  const projeto = await novoProjeto(request);
  for (let i = 1; i <= 6; i += 1) {
    await ok(request.post(`/api/projects/${projeto.id}/content`, { headers: HEADERS, data: { title: `Documento ${i}`, kind: 'note', body: `Corpo ${i}. `.repeat(60), createdBy: 'Gemini', sourceKind: 'agent_report' } }));
  }
  await abrir(page, projeto, 'Biblioteca');

  await page.locator('.library-item', { hasText: 'Documento 5' }).click();

  const leitor = page.locator('.library-document');
  await aoVivo(page, leitor);
  await expect(leitor).toBeFocused();
  expect(await estaNaTela(page, page.locator('.library-item.is-active'))).toBe(true);
});

test('Ctrl K: ao chegar no projeto, o nome dele e o item da barra lateral acendem', async ({ page, request }) => {
  const projeto = await novoProjeto(request, 'Destino do Ctrl K');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#projects');
  await expect(page.getByRole('button', { name: 'Buscar projetos e ações' })).toBeVisible();
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Buscar comandos e projetos' }).fill(projeto.name);
  await page.keyboard.press('Enter');

  const nome = page.locator(`h1[data-chegada="projeto:${projeto.id}"]`);
  await expect(nome).toHaveClass(DESTAQUE);
  await expect(nome).toBeFocused();
  await expect(page.locator(`a[data-chegada="projeto-lateral:${projeto.id}"]`)).toHaveClass(DESTAQUE);
});

test('com movimento reduzido o destino fica marcado por um contorno parado, sem animação', async ({ page, request }) => {
  const projeto = await novoProjeto(request);
  await ok(request.post(`/api/projects/${projeto.id}/approvals`, { headers: HEADERS, data: { agent: 'Gemini', kind: 'note', title: 'Ajuste de contraste', body: 'Trocar a cor do rótulo.', rationale: 'Cumprir o contraste mínimo.' } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await abrir(page, projeto, 'Visão geral');

  await page.getByRole('button', { name: /^Ver propostas/ }).click();

  const bloco = page.locator('#fila-de-aprovacoes');
  await expect(bloco).toHaveClass(DESTAQUE);
  const estilo = await bloco.evaluate(el => { const s = getComputedStyle(el); return { animacao: s.animationName, contorno: s.outlineStyle, largura: parseFloat(s.outlineWidth) }; });
  expect(estilo.animacao).toBe('none');
  expect(estilo.contorno).not.toBe('none');
  expect(estilo.largura).toBeGreaterThanOrEqual(2);
  await expect(bloco).not.toHaveClass(DESTAQUE, { timeout: 4000 });
});
