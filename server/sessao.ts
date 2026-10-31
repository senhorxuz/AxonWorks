/**
 * A porta da Axon quando ela fica na internet: sessão por cookie e freio contra
 * quem tenta adivinhar a senha.
 *
 * O cookie guarda a sessão de um jeito que nenhum script da página consegue ler
 * (HttpOnly) e que nenhum outro site consegue usar (SameSite=Strict).
 */

export const NOME_COOKIE = 'axon_sessao';
export const HORAS_DE_SESSAO = 12;
const SEGUNDOS_DE_SESSAO = HORAS_DE_SESSAO * 3600;

/** Lê um cookie do cabeçalho enviado pelo navegador. */
export function lerCookie(cabecalho: string | undefined, nome: string): string | undefined {
  if (!cabecalho) return undefined;
  for (const parte of cabecalho.split(';')) {
    const igual = parte.indexOf('=');
    if (igual === -1) continue;
    if (parte.slice(0, igual).trim() !== nome) continue;
    const valor = parte.slice(igual + 1).trim();
    return valor ? decodeURIComponent(valor) : undefined;
  }
  return undefined;
}

/** `seguro` só é ligado no servidor: no computador local o endereço é http e o cookie não chegaria. */
export function cookieDeSessao(token: string, seguro: boolean): string {
  const partes = [`${NOME_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SEGUNDOS_DE_SESSAO}`];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

export function cookieApagado(seguro: boolean): string {
  const partes = [`${NOME_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

/**
 * Conta os erros de senha por usuário e tranca a porta por alguns minutos.
 * Fica na memória do processo: reiniciar a Axon limpa a contagem, o que é
 * aceitável porque reiniciar é coisa de dono, não de quem está tentando entrar.
 */
export class FreioDeLogin {
  private readonly registros = new Map<string, { erros: number; bloqueadoAte: number; visto: number }>();

  constructor(
    private readonly limite = 5,
    private readonly minutos = 15,
    private readonly maximoDeChaves = 500,
  ) {}

  /** Quantos minutos faltam para destravar. Zero quando está liberado. */
  minutosBloqueado(chave: string, agora = Date.now()): number {
    const registro = this.registros.get(this.normalizar(chave));
    if (!registro || registro.bloqueadoAte <= agora) return 0;
    return Math.max(1, Math.ceil((registro.bloqueadoAte - agora) / 60000));
  }

  registrarErro(chave: string, agora = Date.now()): void {
    const nome = this.normalizar(chave);
    const registro = this.registros.get(nome) ?? { erros: 0, bloqueadoAte: 0, visto: agora };
    registro.erros += 1;
    registro.visto = agora;
    if (registro.erros >= this.limite) {
      registro.bloqueadoAte = agora + this.minutos * 60000;
      registro.erros = 0;
    }
    this.registros.set(nome, registro);
    this.podar(agora);
  }

  limpar(chave: string): void {
    this.registros.delete(this.normalizar(chave));
  }

  private normalizar(chave: string): string {
    return chave.trim().toLowerCase();
  }

  /** Evita que tentativas com nomes inventados encham a memória. */
  private podar(agora: number): void {
    if (this.registros.size <= this.maximoDeChaves) return;
    for (const [nome, registro] of this.registros) {
      if (registro.bloqueadoAte <= agora && agora - registro.visto > this.minutos * 60000) this.registros.delete(nome);
    }
    while (this.registros.size > this.maximoDeChaves) {
      const maisAntigo = this.registros.keys().next().value;
      if (maisAntigo === undefined) break;
      this.registros.delete(maisAntigo);
    }
  }
}
