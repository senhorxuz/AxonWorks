/**
 * Quem pode falar com a Axon, e em que modo ela roda.
 *
 * Por padrão a Axon aceita somente o próprio computador (127.0.0.1 e localhost).
 * Numa VPS atrás de uma rede privada (Tailscale), o nome da máquina na rede privada
 * precisa ser declarado em AXON_ALLOWED_HOSTS, separado por vírgula.
 */

import path from 'node:path';

export type ModoAxon = 'local' | 'servidor';

const LOCAL = new Set(['127.0.0.1', 'localhost']);
const FORMATO_HOST = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/i;

export function lerModo(valor: string | undefined = process.env.AXON_MODE): ModoAxon {
  if (valor === undefined || valor === 'local') return 'local';
  if (valor === 'servidor') return 'servidor';
  throw new Error(`AXON_MODE deve ser "local" ou "servidor" (recebido: "${valor}").`);
}

export function lerHostsPermitidos(valor: string | undefined = process.env.AXON_ALLOWED_HOSTS): string[] {
  if (!valor) return [];
  return valor.split(',').map(nome => nome.trim().toLowerCase()).filter(Boolean);
}

/** Nome do host sem a porta, ou null quando o cabeçalho não tem formato de host. */
function nomeDoHost(cabecalhoHost: string): string | null {
  const achado = FORMATO_HOST.exec(cabecalhoHost.trim());
  return achado ? achado[1]!.toLowerCase() : null;
}

export function hostPermitido(cabecalhoHost: string, extras: readonly string[]): boolean {
  const nome = nomeDoHost(cabecalhoHost);
  if (!nome) return false;
  return LOCAL.has(nome) || extras.includes(nome);
}

export function hostLocal(cabecalhoHost: string): boolean {
  const nome = nomeDoHost(cabecalhoHost);
  return nome !== null && LOCAL.has(nome);
}

/** A página que faz a escrita precisa ser servida pelo mesmo host (http local ou https da rede privada). */
export function origemPermitida(origem: string, cabecalhoHost: string): boolean {
  const host = cabecalhoHost.trim().toLowerCase();
  const alvo = origem.trim().toLowerCase();
  return alvo === `http://${host}` || alvo === `https://${host}`;
}

/**
 * Na VPS, a IA roda no computador dela e abre o MCP pelo SSH.
 * O usuário "axon" e o script deploy/mcp.sh são criados por deploy/instalar.sh.
 */
export function conexaoMcpPeloSsh(host: string, raizDoApp: string): { command: string; args: string[] } {
  const script = path.posix.join(raizDoApp.replaceAll('\\', '/'), 'deploy', 'mcp.sh');
  // accept-new: guarda a identidade da VPS na primeira conexão e recusa se ela mudar depois.
  return { command: 'ssh', args: ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', `axon@${host}`, script] };
}
