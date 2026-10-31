/**
 * Troca a pasta de trabalho dos projetos (ex.: do Windows para a VPS),
 * para a conferência de arquivos continuar funcionando no servidor.
 *
 * Uso: npx tsx scripts/vps/trocar-pasta.ts "D:\projetos\axon" /srv/axon/projetos/axon
 */
import { dbPath } from '../../server/config.js';
import { WorkspaceStore } from '../../server/store.js';

const [de, para] = process.argv.slice(2);
if (!de || !para) {
  console.error('Uso: npx tsx scripts/vps/trocar-pasta.ts "<pasta antiga>" <pasta nova>');
  process.exit(1);
}
const store = new WorkspaceStore(dbPath);
try {
  const quantos = store.substituirPastaDeTrabalho(de, para);
  console.log(quantos === 0
    ? `Nenhum projeto usava "${de}". Nada foi mudado.`
    : `${quantos} projeto(s) agora usam "${para}".`);
} finally {
  store.close();
}
