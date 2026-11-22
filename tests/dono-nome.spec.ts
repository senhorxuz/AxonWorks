import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Frente "dono e cores" — item 3.1 (o dono não é tratado como IA) e item 12.4 (foco nos modais).
 * Sem page.route: tudo nasce de verdade pela API e o servidor real responde.
 */
const HEADERS = { 'X-Workspace-Client': 'local' };

async function criarProjeto(request: APIRequestContext, name: string) {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name, objective: 'Objetivo do teste.' } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

test.describe('3.1 — o dono grava sem digitar nome de IA', () => {
  test('capturar ideia no Backlog funciona com o nome da IA vazio e assina como Dono do projeto', async ({ page, request }) => {
    const project = await criarProjeto(request, 'Dono Backlog ' + Date.now());
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByLabel('Nome do agente')).toHaveValue('');
    await page.getByRole('tab', { name: /^Backlog/ }).click();
    await page.getByLabel('Título da ideia').fill('Ideia do dono sem nome de IA');
    await page.getByRole('button', { name: 'Capturar ideia', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Ideias em avaliação' })).toContainText('Ideia do dono sem nome de IA');
    await expect(page.getByRole('alert')).toHaveCount(0);
    const lista = await (await request.get(`/api/projects/${project.id}/backlog`)).json();
    expect(lista.find((i: { title: string }) => i.title === 'Ideia do dono sem nome de IA')?.createdBy).toBe('Dono do projeto');
  });

  test('Novo conteúdo na Biblioteca fica ativo sem nome e grava como diretriz humana do Dono', async ({ page, request }) => {
    const project = await criarProjeto(request, 'Dono Biblioteca ' + Date.now());
    await page.goto(`/#project/${project.id}`);
    await page.getByRole('tab', { name: 'Biblioteca', exact: true }).click();
    const novo = page.getByRole('button', { name: 'Novo conteúdo', exact: true });
    await expect(novo).toBeEnabled();
    await novo.click();
    const dialogo = page.getByRole('dialog', { name: 'Novo conteúdo', exact: true });
    await dialogo.getByLabel('Título').fill('Texto do dono');
    await dialogo.getByLabel('Texto do conteúdo').fill('Escrito pelo dono, sem nome de IA.');
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(dialogo).not.toBeVisible();
    const lista = await (await request.get(`/api/projects/${project.id}/content`)).json();
    const doc = lista.find((i: { item: { title: string } }) => i.item.title === 'Texto do dono')?.item;
    expect(doc).toBeTruthy();
    const completo = await (await request.get(`/api/projects/${project.id}/content/${doc.id}`)).json();
    expect(JSON.stringify(completo)).toContain('Dono do projeto');
    expect(JSON.stringify(completo)).toContain('human_directive');
  });

  test('aceitar decisão: o campo já vem como Dono do projeto, sem exigir nome', async ({ page, request }) => {
    const project = await criarProjeto(request, 'Dono Decisão ' + Date.now());
    const proposta = await request.post(`/api/projects/${project.id}/decisions`, { headers: HEADERS, data: { title: 'Usar grafite', body: 'Cor neutra.', agent: 'Astra' } });
    expect(proposta.ok()).toBeTruthy();
    await page.goto(`/#project/${project.id}`);
    await page.getByRole('tab', { name: /^Decisões/ }).click();
    await page.getByRole('button', { name: /^Aceitar decisão/ }).first().click();
    const dialogo = page.getByRole('dialog', { name: 'Aceitar decisão', exact: true });
    await expect(dialogo.getByLabel('Quem decide')).toHaveValue('Dono do projeto');
  });

  test('"Informar nome" leva ao campo da barra lateral: rola, foca e destaca', async ({ page, request }) => {
    const project = await criarProjeto(request, 'Dono Informar ' + Date.now());
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByLabel('Nome do agente')).toHaveValue('');
    const dica = page.locator('.agent-warning-hint');
    await expect(dica).toContainText('Informe o nome na barra lateral');
    await dica.getByRole('button', { name: 'Informar nome' }).click();
    await expect(page.getByLabel('Nome do agente')).toBeFocused();
    await expect(page.locator('.agent-field')).toHaveClass(/axon-chegou/);
    await expect(page.locator('.agent-field')).not.toHaveClass(/axon-chegou/, { timeout: 4000 });
    await expect(page.locator('.identity-help')).toContainText('Dono do projeto');
  });

  test('no celular, "Informar nome" abre o menu e foca o campo', async ({ page, request }) => {
    const project = await criarProjeto(request, 'Dono Celular ' + Date.now());
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/#project/${project.id}`);
    await page.locator('.agent-warning-hint').getByRole('button', { name: 'Informar nome' }).click();
    await expect(page.getByLabel('Nome do agente')).toBeFocused();
    await expect(page.getByLabel('Nome do agente')).toBeInViewport();
  });
});

test.describe('12.4 — foco e fechamento dos modais', () => {
  test('Tab fica preso dentro do Novo projeto, também com o botão principal desativado', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
    await expect(modal.getByLabel('Nome do projeto')).toBeFocused();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
    }
  });

  test('Exportar contexto abre com o foco na ação principal, não no X', async ({ page, request }) => {
    const project = await criarProjeto(request, 'Foco Exportar ' + Date.now());
    await page.goto(`/#project/${project.id}`);
    await page.getByRole('button', { name: 'Exportar contexto' }).click();
    const modal = page.getByRole('dialog', { name: 'Exportar contexto' });
    await expect(modal.getByRole('button', { name: /Copiar contexto/ })).toBeFocused();
  });

  test('Conectar IA abre com o foco fora do X', async ({ page, request }) => {
    const project = await criarProjeto(request, 'Foco Conectar ' + Date.now());
    await page.goto(`/#project/${project.id}`);
    await page.getByRole('button', { name: 'Conectar IA' }).click();
    const modal = page.getByRole('dialog').last();
    await expect(modal).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).not.toBe('Fechar diálogo');
  });

  test('fechar com texto digitado pergunta antes; sem texto fecha direto; Esc devolve o foco a quem abriu', async ({ page }) => {
    await page.goto('/');
    const abrir = page.getByRole('button', { name: 'Novo projeto', exact: true });
    await abrir.click();
    const modal = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
    // Sem texto: Esc fecha direto e o foco volta ao botão que abriu.
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
    await expect(abrir).toBeFocused();
    // Com texto: clicar fora não fecha, pergunta.
    await abrir.click();
    await modal.getByLabel('Nome do projeto').fill('Texto que não pode se perder');
    await page.mouse.click(4, 4);
    const pergunta = modal.getByRole('alertdialog');
    await expect(pergunta).toBeVisible();
    await expect(modal).toBeVisible();
    await pergunta.getByRole('button', { name: 'Continuar editando' }).click();
    await expect(pergunta).toHaveCount(0);
    await expect(modal.getByLabel('Nome do projeto')).toHaveValue('Texto que não pode se perder');
    // Esc também pergunta; descartar fecha.
    await page.keyboard.press('Escape');
    await expect(modal.getByRole('alertdialog')).toBeVisible();
    await modal.getByRole('button', { name: 'Descartar e fechar' }).click();
    await expect(modal).not.toBeVisible();
  });
});
