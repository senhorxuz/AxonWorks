import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A porta da Axon no servidor, no navegador de verdade.
 *
 * Sobe um segundo servidor em modo servidor (o da suíte roda em modo local, sem porta),
 * com banco próprio e vazio, para passar pela criação da primeira conta.
 */

const PORTA = Number(process.env.E2E_PORTA_ENTRADA ?? 4399);
const BASE = `http://127.0.0.1:${PORTA}`;
const RAIZ = process.cwd();
const DIST = path.resolve(RAIZ, process.env.AXON_DIST_DIR ?? `${process.env.E2E_OUT ?? 'output/playwright'}/dist`);
const SENHA = 'senha-de-teste-12345';

let servidor: ChildProcess;
let pasta: string;

test.beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'axon-porta-'));
  servidor = spawn(
    process.execPath,
    // No Windows o caminho absoluto precisa virar URL file:// para o Node aceitar.
    ['--import', pathToFileURL(path.resolve(RAIZ, 'node_modules/tsx/dist/loader.mjs')).href, 'server/index.ts', '--production'],
    {
      cwd: RAIZ,
      stdio: 'ignore',
      env: {
        ...process.env,
        AXON_MODE: 'servidor',
        AXON_PORT: String(PORTA),
        AXON_DB_PATH: path.join(pasta, 'porta.sqlite'),
        AXON_BACKUP_DIR: path.join(pasta, 'backups'),
        AXON_DIST_DIR: DIST,
      },
    },
  );
  const limite = Date.now() + 40000;
  for (;;) {
    try {
      const resposta = await fetch(`${BASE}/api/health`);
      if (resposta.ok) break;
    } catch { /* ainda subindo */ }
    if (Date.now() > limite) throw new Error('o servidor em modo servidor não subiu');
    await new Promise(r => setTimeout(r, 300));
  }
});

test.afterAll(async () => {
  if (servidor && !servidor.killed) {
    const fim = new Promise(r => servidor.once('exit', r));
    servidor.kill();
    // Espera o processo soltar o arquivo do banco antes de apagar a pasta.
    await Promise.race([fim, new Promise(r => setTimeout(r, 4000))]);
  }
  try { rmSync(pasta, { recursive: true, force: true }); } catch { /* o Windows às vezes segura o arquivo mais um instante */ }
});

test('a porta da Axon: criar a primeira conta, sair, errar a senha e voltar', async ({ page }, info) => {
  // 1. Primeira visita: a Axon pede para criar a conta dona.
  await page.goto(BASE);
  await expect(page.getByRole('heading', { name: 'Crie sua conta' })).toBeVisible();
  await expect(page.getByText('Nenhum projeto')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('porta-primeira-conta.png'), fullPage: true });

  await page.getByLabel('Seu nome').fill('Ana');
  await page.getByLabel('Usuário').fill('dono');
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByLabel('Repita a senha').fill(SENHA);
  await page.getByRole('button', { name: 'Criar conta e entrar' }).click();

  // 2. Entrou: a Axon aparece.
  await expect(page.getByRole('link', { name: 'Axon Works, projetos' })).toBeVisible();

  // 3. A sessão sobrevive a recarregar a página.
  await page.reload();
  await expect(page.getByRole('link', { name: 'Axon Works, projetos' })).toBeVisible();

  // 4. Sair fecha a porta.
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('porta-entrar.png'), fullPage: true });

  // 5. Senha errada não entra, e a mensagem não entrega qual campo errou.
  await page.getByLabel('Usuário').fill('dono');
  await page.getByLabel('Senha', { exact: true }).fill('chute-errado');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Usuário ou senha incorretos.');

  // 6. Com a senha certa, volta para dentro.
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Axon Works, projetos' })).toBeVisible();
});
