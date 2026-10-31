import path from 'node:path';
import { mkdirSync } from 'node:fs';
import express from 'express';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { WorkspaceStore } from './store.js';
import { dbPath, projectRoot } from './config.js';
import { criarDesligamentoPorOciosidade } from './ocioso.js';

const port = Number(process.env.AXON_PORT ?? '4317');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('AXON_PORT deve estar entre 1024 e 65535.');
mkdirSync(path.dirname(dbPath), { recursive: true });
const store = new WorkspaceStore(dbPath);
const app = createApp(store);
const server = createServer(app);
const production = process.argv.includes('--production');
// Pasta do build servida em producao. Sobrescrevivel para que execucoes
// paralelas da suite E2E nao escrevam e sirvam o mesmo dist/ ao mesmo tempo.
const distDir = process.env.AXON_DIST_DIR ? path.resolve(process.env.AXON_DIST_DIR) : path.join(projectRoot, 'dist');
let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
if (production) {
  app.use(express.static(distDir, { dotfiles: 'deny' }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    root: projectRoot,
    server: { middlewareMode: true, hmr: { server }, fs: { strict: true, allow: [projectRoot], deny: ['**/.env*', '**/.git/**', '**/.axon/**', '**/*.sqlite*', '**/output/**', '**/*.{crt,pem,key}'] } },
    appType: 'spa'
  });
  app.use(vite.middlewares);
}
// Ligada pelo atalho da Área de Trabalho: se ninguém usar a tela por AXON_DESLIGAR_OCIOSO_MIN minutos, a Axon se
// desliga (regra em server/ocioso.ts). Sem a variável nada muda: `npm start`, os testes de tela e a VPS seguem ligados.
const minutosOciosos = process.env.AXON_DESLIGAR_OCIOSO_MIN;
const desligamento = minutosOciosos === undefined ? undefined : criarDesligamentoPorOciosidade({
  minutos: Number(minutosOciosos),
  agora: Date.now,
  aoDesligar: () => {
    console.log(`AXON desligada: sem uso há ${minutosOciosos} min.`);
    shutdown().then(() => process.exit(0), erro => { console.error(`AXON não desligou direito: ${erro instanceof Error ? erro.message : String(erro)}`); process.exit(1); });
  },
  // `unref`: a conferência nunca segura o processo vivo; quem o mantém é o servidor.
  agendar: (fn, ms) => { const marca = setTimeout(fn, ms); marca.unref(); return { cancelar: () => clearTimeout(marca) }; },
});
// Toda requisição conta como uso. Entra no servidor HTTP, antes do Express: um `app.use` aqui ficaria depois das
// rotas já registradas em `createApp`, e as da API responderiam sem passar por ele.
if (desligamento) server.prependListener('request', () => desligamento.registrarAtividade());
server.on('error', async error => {
  console.error(`AXON não iniciou: ${(error as NodeJS.ErrnoException).code ?? 'erro'}`);
  desligamento?.parar();
  await vite?.close();
  store.close();
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`AXON disponível em http://127.0.0.1:${port} (${production ? 'produção local' : 'desenvolvimento'})`));
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  desligamento?.parar();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await vite?.close();
  store.close();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
