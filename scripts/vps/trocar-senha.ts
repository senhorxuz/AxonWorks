/**
 * Troca a senha de uma conta da Axon. É a saída para quem esqueceu a senha:
 * só roda na própria VPS, por quem já tem acesso ao servidor.
 * Todas as sessões abertas daquela conta caem.
 *
 * Uso na VPS:
 *   sudo -u axon bash -c 'cd /srv/axon/app && set -a && . /etc/axon/axon.env && set +a && npx tsx scripts/vps/trocar-senha.ts dono'
 *
 * A senha é digitada na hora e não aparece na tela nem no histórico de comandos.
 */
import { createInterface } from 'node:readline/promises';
import { dbPath } from '../../server/config.js';
import { WorkspaceStore } from '../../server/store.js';

const usuario = process.argv[2];
if (!usuario) {
  console.error('Informe o usuário. Exemplo: npx tsx scripts/vps/trocar-senha.ts dono');
  process.exit(1);
}

const leitor = createInterface({ input: process.stdin, output: process.stdout });
const senha = await leitor.question('Nova senha (pelo menos 12 caracteres): ');
const confirmacao = await leitor.question('Repita a nova senha: ');
leitor.close();

if (senha !== confirmacao) {
  console.error('As duas senhas são diferentes. Nada foi alterado.');
  process.exit(1);
}

const store = new WorkspaceStore(dbPath);
try {
  store.trocarSenha(usuario, senha);
  console.log(`Senha de "${usuario}" trocada. As sessões abertas caíram: entre de novo no navegador.`);
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exitCode = 1;
} finally {
  store.close();
}
