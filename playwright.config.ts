import { defineConfig } from '@playwright/test';
import path from 'node:path';

// Porta e pasta de resultados configuraveis para permitir execucoes em paralelo.
// Sem isso, duas suites ao mesmo tempo disputam a porta 4318 e uma apaga a
// pasta de resultados da outra no meio da corrida.
const E2E_PORT = process.env.E2E_PORT ?? '4318';
const E2E_OUT = process.env.E2E_OUT ?? 'output/playwright';

// Caminho do banco da suite, calculado UMA vez e herdado pelos processos de teste.
// O config e reavaliado em cada worker; sem o ??= cada um geraria outro caminho.
// Testes podem PREPARAR estado impossivel de produzir em tempo real — por exemplo,
// uma reserva vencida ha horas — escrevendo direto nesse banco. Isso e arranjo de
// dados, nao simulacao: servidor e tela continuam reais.
process.env.AXON_E2E_DB_PATH ??= path.resolve(`${E2E_OUT}/e2e-${Date.now()}.sqlite`);
const E2E_DB = process.env.AXON_E2E_DB_PATH;

export default defineConfig({
  testDir: './tests', testMatch: '*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 45000, expect: { timeout: 8000 },
  reporter: [['list'], ['html', { outputFolder: `${E2E_OUT}/report`, open: 'never' }]],
  outputDir: `${E2E_OUT}/results`,
  use: { baseURL: `http://127.0.0.1:${E2E_PORT}`, browserName: 'chromium', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: { width: 1440, height: 1000 } },
  // A suite testa o BUILD DE PRODUCAO, nunca o servidor de desenvolvimento.
  //
  // Em `npm run dev` o Vite roda em modo middleware, no mesmo processo e no mesmo
  // event loop da API, transformando modulos sob demanda. As requisicoes da API
  // enfileiram atras dessas transformacoes: rotas que custam 1 ms no servidor
  // chegavam a 9 s no navegador e cruzavam o limite de 8 s de forma aleatoria.
  // Medido em 16/09/2026: dev = 4,1 a 6,2 min com 1 a 3 falhas em todas as 7
  // execucoes; producao = 1,5 min e 26/26.
  //
  // Alem de estavel, testar o build e o correto: e isso que e entregue.
  //
  // O build e refeito a cada execucao. Rodar so `npm start` sobre um dist/
  // existente faria a suite passar contra codigo velho. O `&&` garante que, se
  // o build falhar, o servidor nao sobe e a suite quebra em vez de mentir.
  webServer: {
    command: `npx vite build --outDir ${E2E_OUT}/dist --emptyOutDir && npm start`, url: `http://127.0.0.1:${E2E_PORT}/api/health`, timeout: 90000, reuseExistingServer: false,
    env: { AXON_PORT: E2E_PORT, AXON_DIST_DIR: `${E2E_OUT}/dist`, AXON_DB_PATH: E2E_DB }
  }
});
