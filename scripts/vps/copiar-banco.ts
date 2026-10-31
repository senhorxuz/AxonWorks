/**
 * Cria uma cópia consistente do banco da Axon para levar à VPS.
 * Pode rodar com a Axon aberta: a cópia é feita pelo próprio SQLite (VACUUM INTO).
 *
 * Uso: npx tsx scripts/vps/copiar-banco.ts axon-para-vps.sqlite
 */
import path from 'node:path';
import { dbPath } from '../../server/config.js';
import { WorkspaceStore } from '../../server/store.js';

const destino = process.argv[2];
if (!destino) {
  console.error('Informe o arquivo de destino. Exemplo: npx tsx scripts/vps/copiar-banco.ts axon-para-vps.sqlite');
  process.exit(1);
}
const store = new WorkspaceStore(dbPath);
try {
  const caminho = path.resolve(destino);
  store.copiarBancoPara(caminho);
  console.log(`Cópia criada: ${caminho}`);
  console.log(`Projetos na cópia: ${new WorkspaceStore(caminho).listProjects().length}`);
} finally {
  store.close();
}
