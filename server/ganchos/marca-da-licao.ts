// A retomada compacta mostra erros, regras e verificações no mesmo bloco de lições. Cada linha leva a marca
// do tipo, para a IA saber o que é regra do dono e o que é erro anotado. Erro continua sem marca.
import type { Licao, MomentoDaVerificacao } from '../../shared/licoes.js'

const MARCA_DO_MOMENTO: Record<MomentoDaVerificacao, string> = {
  antes_de_subir: 'verificação antes de subir',
  antes_de_pronto: 'verificação antes de dizer pronto',
  antes_de_commit: 'verificação antes de commit ou junção',
}

/** Verificação sem momento (não deveria existir) fica só como "verificação". */
function marcaDaLicao(licao: Licao): string | null {
  if (licao.tipo === 'regra') return 'regra do dono'
  if (licao.tipo === 'verificacao') return licao.momento === null ? 'verificação' : MARCA_DO_MOMENTO[licao.momento]
  return null
}

export function textoDaLicaoNaRetomada(licao: Licao): string {
  const marca = marcaDaLicao(licao)
  return marca === null ? licao.texto : `${licao.texto} (${marca})`
}
