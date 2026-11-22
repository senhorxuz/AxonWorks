import type { Licao, MomentoDaVerificacao } from '../../shared/licoes'

export type AcaoSobreLicao =
  | { tipo: 'criar'; categoria: 'regra' | 'verificacao' }
  | { tipo: 'corrigir' | 'aposentar'; licao: Licao }

export const ROTULOS_DOS_MOMENTOS: Record<MomentoDaVerificacao, string> = {
  antes_de_subir: 'Antes de subir',
  antes_de_pronto: 'Antes de dizer pronto',
  antes_de_commit: 'Antes de commit ou junção',
}

export function separarLicoes(licoes: readonly Licao[]) {
  const regras: Licao[] = []
  const errosDoProjeto: Licao[] = []
  const errosGerais: Licao[] = []
  const verificacoes: Record<MomentoDaVerificacao, Licao[]> = {
    antes_de_subir: [], antes_de_pronto: [], antes_de_commit: [],
  }
  for (const licao of licoes) {
    if (licao.tipo === 'regra') regras.push(licao)
    else if (licao.tipo === 'erro') (licao.projectId === null ? errosGerais : errosDoProjeto).push(licao)
    else if (licao.momento !== null) verificacoes[licao.momento].push(licao)
  }
  return { regras, errosDoProjeto, errosGerais, verificacoes }
}

export function aplicarLicao(licoes: readonly Licao[], licao: Licao): Licao[] {
  const ativas = licoes.filter(item => item.id !== licao.substituiId)
  if (licao.aposentadaEm !== null) return ativas.filter(item => item.id !== licao.id)
  if (ativas.some(item => item.id === licao.id)) return ativas
  return [...ativas, licao]
}

export function autoriaDaLicao(licao: Licao): string {
  if (licao.tipo === 'erro') return `Anotado por ${licao.origem === 'Dono' ? 'você' : licao.origem}`
  return licao.origem === 'Dono' ? 'Dita por você' : `Anotada por ${licao.origem}`
}

const formatoDaData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

export function dataDaLicao(iso: string): string {
  return formatoDaData.format(new Date(iso))
}

export function resumoDaFalha(quantas: number, ultimaEm: string): string {
  return `Falhou ${quantas} ${quantas === 1 ? 'vez' : 'vezes'} · Última em ${dataDaLicao(ultimaEm)}`
}

const MENSAGENS = new Map(Object.entries({
  regra_precisa_de_projeto: 'Abra um projeto para guardar esta orientação.',
  frase_do_dono_obrigatoria: 'Escreva a orientação com suas palavras.',
  momento_obrigatorio: 'Escolha quando a verificação deve ser feita.',
  momento_so_em_verificacao: 'Só as verificações têm um momento para conferir.',
  pedido_do_dono_obrigatorio: 'Escreva o motivo para retirar este item.',
  licao_igual_ja_existe: 'Já existe uma orientação ativa com esse texto. Escreva um texto diferente.',
  tipo_diferente_na_substituicao: 'Uma correção precisa manter o mesmo tipo de orientação.',
  escopo_diferente: 'Só é possível corrigir uma orientação no lugar onde ela foi anotada.',
  lesson_already_retired: 'Este item já saiu da lista. Reabra a aba para atualizar.',
  not_found: 'Não encontramos este item. Reabra a aba para atualizar.',
  invalid_input: 'Confira os campos e tente novamente.',
  corrupted_text: 'Alguns caracteres vieram ilegíveis. Digite o texto de novo.',
  so_o_dono: 'Só você, na conta de dono, pode fazer esta alteração.',
  forbidden_project_scope: 'Seu acesso não permite fazer esta alteração.',
}))

export function mensagemDaEscrita(codigo = ''): string {
  return MENSAGENS.get(codigo) ?? 'Não foi possível salvar agora. Tente novamente.'
}

const novaRegra = { titulo: 'Nova regra', campo: 'Texto da regra', botao: 'Salvar regra', sucesso: 'Regra salva.' }
const novaVerificacao = { titulo: 'Nova verificação', campo: 'O que precisa ser conferido', botao: 'Salvar verificação', sucesso: 'Verificação salva.' }
const nomes = { erro: 'erro', regra: 'regra', verificacao: 'verificação' }
const mensagensDeRetirada = { erro: 'Erro aposentado.', regra: 'Regra aposentada.', verificacao: 'Verificação aposentada.' }

export function rotulosDaEdicao(acao: AcaoSobreLicao) {
  if (acao.tipo === 'criar') return acao.categoria === 'regra' ? novaRegra : novaVerificacao
  const { tipo } = acao.licao
  if (acao.tipo === 'corrigir') {
    const campo = tipo === 'regra' ? novaRegra.campo : novaVerificacao.campo
    return { titulo: `Corrigir ${nomes[tipo]}`, campo, botao: 'Salvar correção', sucesso: 'Correção salva.' }
  }
  const titulo = `Aposentar ${nomes[tipo]}`
  return { titulo, campo: 'Motivo', botao: titulo, sucesso: mensagensDeRetirada[tipo] }
}

function palavrasDe(texto: string): string[] {
  return texto.match(/[\p{L}\p{N}]+/gu) ?? []
}

/** Mesma palavra sem contar maiúscula nem acento ("Página" = "pagina"). */
const mesmaPalavra = new Intl.Collator('pt-BR', { sensitivity: 'base' })

/**
 * A frase do dono repete o título da orientação quando TODAS as palavras dela já estão no título (igual, só mais
 * curta, ou as mesmas palavras em outra ordem): mostrar de novo é ruído. Qualquer palavra nova vale mostrar, em
 * especial uma negação ("não", "nunca", "jamais") que o título não tem: ela vira o sentido da regra do avesso.
 */
export function fraseRepetida(titulo: string, frase: string): boolean {
  const doTitulo = palavrasDe(titulo)
  return palavrasDe(frase).every(palavra => doTitulo.some(outra => mesmaPalavra.compare(palavra, outra) === 0))
}
