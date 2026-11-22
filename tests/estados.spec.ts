import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Pente fino de UX (22/11/2026), frente "estados": servidor fora do ar, falha ao abrir projeto, carregamento,
 * Decisões com propostas à vista e contagens que batem, Checkpoints enxutos, Retomar e Mensagens.
 * O servidor e o banco são de verdade; só a falha de rede é simulada, interceptando o navegador.
 */

const HEADERS = { 'X-Workspace-Client': 'local' };
const TEXTO_SERVIDOR_FORA = 'Não consegui falar com a Axon neste computador. Seus dados continuam guardados.';

async function ok<T>(resposta: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await resposta;
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json() as Promise<T>;
}

async function criarProjeto(request: APIRequestContext, name: string) {
  return ok<{ id: string; name: string }>(request.post('/api/projects', { headers: HEADERS, data: { name, objective: 'Objetivo do projeto de teste.' } }));
}

function contagemDaBarra(page: Page) {
  return page.locator('.sidebar nav a', { hasText: 'Projetos' }).locator('.nav-count');
}

test.describe('carga: servidor fora do ar e falhas ao abrir', () => {
  test('servidor fora do ar não vira "nenhum projeto": mostra o erro, "–" na barra e deixa tentar de novo', async ({ page }) => {
    await page.route('**/api/projects', route => route.abort('connectionrefused'));
    await page.goto('/');

    await expect(page.getByText(TEXTO_SERVIDOR_FORA)).toBeVisible();
    await expect(page.getByText('Failed to fetch')).toHaveCount(0);
    // O defeito: a mesma tela dizia "Sua área de trabalho está pronta", "0 projetos" e "00".
    await expect(page.getByText('Sua área de trabalho está pronta')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Adicionar primeiro projeto' })).toHaveCount(0);
    await expect(page.getByText(/^0 projetos$/)).toHaveCount(0);
    await expect(contagemDaBarra(page)).toHaveText('–');
    await expect(page.getByRole('heading', { name: /^Projetos/ })).toContainText('–');

    await page.unroute('**/api/projects');
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByText(TEXTO_SERVIDOR_FORA)).toHaveCount(0);
    await expect(contagemDaBarra(page)).toHaveText(/^\d{2,}$/);
  });

  test('carregamento lento: texto em português, contagem "–" e esqueleto da lista na barra lateral', async ({ page, request }) => {
    const projeto = await criarProjeto(request, 'Carregamento lento');
    let liberar!: () => void;
    const portao = new Promise<void>(resolve => { liberar = resolve; });
    await page.route(/\/api\/projects(\/[^/]+)?$/, async route => { await portao; await route.continue(); });
    await page.goto(`/#project/${projeto.id}`);

    await expect(page.getByRole('status').filter({ hasText: 'Carregando seus projetos…' }).first()).toBeAttached();
    await expect(page.getByText('Carregando seu workspace')).toHaveCount(0);
    await expect(contagemDaBarra(page)).toHaveText('–');
    await expect(page.locator('.recent-projects-esqueleto')).toBeVisible();

    liberar();
    await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toBeVisible();
    await expect(contagemDaBarra(page)).toHaveText(/^\d{2,}$/);
    await expect(page.locator('.recent-projects-esqueleto')).toHaveCount(0);
  });

  test('falha ao abrir um projeto não fala em salvar e não derruba a lista da barra lateral', async ({ page, request }) => {
    const projeto = await criarProjeto(request, 'Projeto que não abre');
    await page.route(`**/api/projects/${projeto.id}`, route => route.fulfill({ status: 500, json: { error: { code: 'internal', message: 'Não foi possível salvar. Tente novamente.' } } }));
    await page.goto(`/#project/${projeto.id}`);

    await expect(page.getByText('Não consegui abrir este projeto.')).toBeVisible();
    await expect(page.getByText('Não foi possível salvar')).toHaveCount(0);
    // A lista é outra carga: continua inteira.
    await expect(contagemDaBarra(page)).toHaveText(/^(?!00$)\d{2,}$/);
    await expect(page.locator('.recent-projects a').first()).toBeVisible();

    await page.unroute(`**/api/projects/${projeto.id}`);
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toBeVisible();
  });

  test('endereço de projeto inválido ou apagado diz que o projeto não existe, sem jargão, e leva à lista', async ({ page }) => {
    for (const endereco of ['nao-e-um-id', '00000000-0000-4000-8000-000000000000']) {
      await page.goto(`/#project/${endereco}`);
      await expect(page.getByText('Este projeto não existe mais ou o link está errado.')).toBeVisible();
      await expect(page.getByText(/Campo projectId inválido/)).toHaveCount(0);
      await expect(page.getByText('Projeto não encontrado.')).toHaveCount(0);
    }
    await page.getByRole('link', { name: 'Ver todos os projetos' }).click();
    await expect(page.getByRole('heading', { name: /^Projetos/, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/#projects$/);
  });
});

test.describe('Decisões e "esperando você"', () => {
  async function projetoComPendencias(request: APIRequestContext, nome: string) {
    const projeto = await criarProjeto(request, nome);
    const propor = (title: string) => ok<{ id: string; version: number }>(request.post(`/api/projects/${projeto.id}/decisions`, { headers: HEADERS, data: { title, body: `Corpo de ${title}.`, agent: 'Astra' } }));
    const [a, b, c, d] = [await propor('Decisão aberta A'), await propor('Decisão aberta B'), await propor('Decisão vigente'), await propor('Decisão revogada')];
    expect(a && b).toBeTruthy();
    await ok(request.post(`/api/projects/${projeto.id}/decisions/${c.id}/accept`, { headers: HEADERS, data: { actor: 'Dono', expectedVersion: c.version } }));
    await ok(request.post(`/api/projects/${projeto.id}/decisions/${d.id}/accept`, { headers: HEADERS, data: { actor: 'Dono', expectedVersion: d.version } }));
    await ok(request.post(`/api/projects/${projeto.id}/decisions/${d.id}/revoke`, { headers: HEADERS, data: { actor: 'Dono', expectedVersion: d.version + 1, note: 'Mudou de ideia' } }));
    await ok(request.post(`/api/projects/${projeto.id}/approvals`, { headers: HEADERS, data: { agent: 'Gemini', kind: 'charter_change', title: 'Nova diretriz', body: 'Texto da diretriz.', rationale: 'Motivo.' } }));
    await ok(request.post(`/api/projects/${projeto.id}/board/cards`, { headers: HEADERS, data: { actor: 'Gemini', title: 'Aprovar o logotipo', column: 'pending', needsOwner: true } }));
    return projeto;
  }

  test('propostas abertas ficam sempre à vista; o histórico é só revogadas e substituídas', async ({ page, request }) => {
    const projeto = await projetoComPendencias(request, 'Decisões à vista');
    await page.goto(`/#project/${projeto.id}`);
    await page.getByRole('tab', { name: /^Decisões/ }).click();

    const esperando = page.getByRole('region', { name: 'Esperando você aceitar' });
    await expect(esperando).toBeVisible();
    await expect(esperando.locator('.decision-card')).toHaveCount(2);
    await expect(esperando.getByRole('button', { name: 'Aceitar decisão' })).toHaveCount(2);
    // Sem clicar em nada: as propostas já estão na tela, e não atrás de um botão de histórico.
    await expect(page.getByText('Nenhuma decisão vigente no momento.')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Vigentes' }).locator('.decision-card')).toHaveCount(1);

    // O histórico guarda só a revogada.
    await expect(page.locator('.decision-card').filter({ hasText: 'Decisão revogada' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Mostrar histórico (1)' }).click();
    await expect(page.locator('.decision-card').filter({ hasText: 'Decisão revogada' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Esconder histórico' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('aba, Visão geral e Onde paramos contam a mesma coisa; a aba acende em brasa', async ({ page, request }) => {
    const projeto = await projetoComPendencias(request, 'Contagens que batem');
    await page.goto(`/#project/${projeto.id}`);
    // Esperam o dono: 1 proposta para decidir + 2 decisões + 1 cartão do Quadro = 4.
    await page.getByRole('tab', { name: 'Onde paramos', exact: true }).click();
    await expect(page.locator('.carta-grupo[data-grupo="precisa_de_voce"] > h4')).toContainText('4');

    const abaDecisoes = page.getByRole('tab', { name: /^Decisões/ });
    await expect(abaDecisoes.locator('span')).toHaveText('2');
    const corDoNumero = await abaDecisoes.locator('span').evaluate(el => getComputedStyle(el).color);
    expect(corDoNumero, 'o número da aba pede o dono: brasa clara, não o cinza das outras abas').toBe('rgb(246, 178, 142)');

    await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
    const bloco = page.getByRole('region', { name: 'Esperando por você' }).first();
    await expect(bloco.locator('.resumo-numero')).toHaveText('4');
    await expect(bloco).toContainText('4 itens esperam você.');
    await expect(bloco).toContainText('1 proposta para decidir, 2 decisões e 1 cartão do Quadro');

    // Aceitar uma proposta baixa os três números juntos.
    await page.getByRole('tab', { name: /^Decisões/ }).click();
    await page.getByRole('region', { name: 'Esperando você aceitar' }).getByRole('button', { name: 'Aceitar decisão' }).first().click();
    const dialogo = page.getByRole('dialog', { name: 'Aceitar decisão', exact: true });
    await expect(dialogo.getByLabel('Quem decide')).toHaveValue('Dono do projeto');
    await dialogo.getByRole('button', { name: 'Aceitar decisão', exact: true }).click();
    await expect(dialogo).not.toBeVisible();
    await expect(page.getByRole('tab', { name: /^Decisões/ }).locator('span')).toHaveText('1');
    await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Esperando por você' }).first().locator('.resumo-numero')).toHaveText('3');
  });
});

test.describe('Checkpoints', () => {
  test('mostra os 10 mais recentes agrupados por dia, cada um em poucas linhas, e o resto em "Ver mais"', async ({ page, request }) => {
    const projeto = await criarProjeto(request, 'Checkpoints enxutos');
    for (let n = 1; n <= 13; n++) {
      await ok(request.post(`/api/projects/${projeto.id}/checkpoints`, { headers: HEADERS, data: {
        agent: 'Astra', expectedRevision: n - 1, idempotencyKey: `cp-enxuto-${projeto.id}-${n}`,
        summary: `Resumo do registro ${n}. ${'Texto longo para ocupar várias linhas se ninguém cortar. '.repeat(12)}`,
        nextStep: `Próximo passo ${n}. ${'Mais um trecho comprido para cortar. '.repeat(10)}`,
        evidence: [{ command: `npm test #${n}`, outcome: 'passed', details: 'tudo certo' }],
      } }));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/#project/${projeto.id}`);
    await page.getByRole('tab', { name: /^Checkpoints/ }).click();

    const cartoes = page.locator('.checkpoint-card');
    await expect(cartoes).toHaveCount(10);
    await expect(page.getByRole('region', { name: /^Hoje, / })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver mais 3 (faltam 3)' })).toBeVisible();
    // Fechado: poucas linhas e nenhuma evidência à vista (eram 430.000 px de página).
    const primeiro = cartoes.first();
    expect((await primeiro.boundingBox())!.height, 'cartão fechado').toBeLessThan(260);
    await expect(primeiro.locator('.evidence')).toHaveCount(0);
    const alturaDaPagina = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(alturaDaPagina, 'altura da página com 10 registros fechados').toBeLessThan(3600);

    await primeiro.getByRole('button', { name: 'Ver detalhes e evidências (1)' }).click();
    await expect(primeiro.locator('.evidence')).toHaveCount(1);
    await expect(primeiro.getByText('npm test #13')).toBeVisible();
    await expect(primeiro.getByRole('button', { name: 'Ocultar detalhes' })).toHaveAttribute('aria-expanded', 'true');

    await page.getByRole('button', { name: 'Ver mais 3 (faltam 3)' }).click();
    await expect(cartoes).toHaveCount(13);
    await expect(page.getByRole('button', { name: /^Ver mais/ })).toHaveCount(0);
  });
});

test.describe('Mensagens e Retomar', () => {
  test('mensagem para todo mundo se lê "Todas as IAs", nunca "*"', async ({ page, request }) => {
    const projeto = await criarProjeto(request, 'Mensagem geral');
    await ok(request.post(`/api/projects/${projeto.id}/messages`, { headers: HEADERS, data: { from: 'Claude-orquestrador', to: '*', kind: 'note', body: 'Aviso para todo mundo.' } }));
    await page.goto(`/#project/${projeto.id}`);
    await page.getByRole('tab', { name: /^Mensagens/ }).click();
    const cartao = page.locator('.message-card').filter({ hasText: 'Aviso para todo mundo.' });
    await expect(cartao.locator('.message-meta')).toContainText('Todas as IAs');
    await expect(cartao.locator('.message-meta')).not.toContainText('*');
  });

  test('o caminho de pasta de uma passagem chega inteiro à Retomar (a tela e o servidor não mexem nas barras)', async ({ page, request }) => {
    const projeto = await criarProjeto(request, 'Caminho com barras');
    const caminho = 'D:\\Trabalho\\agenda-de-posts';
    await ok(request.post(`/api/projects/${projeto.id}/messages`, { headers: HEADERS, data: { from: 'Claude', to: 'Pente', kind: 'handoff', body: `Comece no repositório ${caminho}. Depois leia o roteiro.` } }));
    await page.goto(`/#project/${projeto.id}`);
    await page.getByLabel('Nome do agente').fill('Pente');
    await page.getByRole('tab', { name: 'Retomar', exact: true }).click();
    const atencao = page.locator('.resume-attention');
    await expect(atencao).toContainText(`repositório ${caminho}.`);
    await expect(atencao).not.toContainText('D:Trabalho');
  });
});
