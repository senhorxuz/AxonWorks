/**
 * Montagem atômica (scripts/montar.mjs): as decisões, sem tocar no disco por conta própria.
 *
 * O `dist-server/` é lido por outros programas enquanto a Axon monta (os ganchos do Claude Code, o servidor do
 * atalho, os testes). Por isso a montagem não grava nele direto: monta numa pasta ao lado e, no fim, troca cada
 * arquivo por `rename`, que é inteiro ou nada. No Windows, o `rename` falha se outro programa estiver com o arquivo
 * aberto naquele instante; aqui fica a regra de quando tentar de novo e a frase que explica a falha.
 *
 * O que mexe no disco (`renomear`, `esperar`, `apagar`, `avisar`) chega por parâmetro: os testes passam um disco
 * falso e o `montar.mjs` passa o de verdade.
 */
import path from 'node:path'

export const PASTA_PADRAO = 'dist-server'
export const VARIAVEL_DE_SAIDA = 'AXON_SAIDA_MONTADO'
/** Repetições depois da primeira tentativa (no total, uma tentativa e até cinco repetições). */
export const MAXIMO_DE_REPETICOES = 5
export const ESPERA_BASE_MS = 100

/** Erros do Windows para "arquivo aberto por outro programa" (ou protegido por ele naquele instante). */
const CODIGOS_DE_ARQUIVO_EM_USO = new Set(['EBUSY', 'EPERM', 'EACCES'])
const OPCAO_DE_SAIDA = '--saida'
const FRASE_SEM_PASTA = `A opção ${OPCAO_DE_SAIDA} precisa de uma pasta. Exemplo: ${OPCAO_DE_SAIDA} dist-teste`

/** Valor de `--saida <pasta>` ou `--saida=<pasta>`; `undefined` se a opção não foi dada; erro se veio sem pasta. */
function valorDaOpcaoDeSaida(argv) {
  const comIgual = `${OPCAO_DE_SAIDA}=`
  const indice = argv.findIndex(argumento => argumento === OPCAO_DE_SAIDA || argumento.startsWith(comIgual))
  if (indice === -1) return undefined
  const argumento = argv[indice]
  const bruto = argumento.startsWith(comIgual) ? argumento.slice(comIgual.length) : argv[indice + 1]
  const valor = bruto?.trim()
  if (!valor || valor.startsWith('--')) throw new Error(FRASE_SEM_PASTA)
  return valor
}

/**
 * Pasta de saída, absoluta. Ordem: `--saida`, depois `AXON_SAIDA_MONTADO`, depois `dist-server` dentro do projeto.
 * Um caminho dado pelo dono vale a partir da pasta onde o comando rodou (`cwd`).
 */
export function resolverPastaDeSaida({ argv, env, raiz, cwd }) {
  const valor = valorDaOpcaoDeSaida(argv) ?? env[VARIAVEL_DE_SAIDA]?.trim()
  return valor ? path.resolve(cwd, valor) : path.resolve(raiz, PASTA_PADRAO)
}

/** Pasta de trabalho ao lado da saída (mesmo disco: é isso que faz o `rename` ser atômico). */
export function pastaTemporariaDe(saida, pid) {
  return `${saida}.novo-${pid}`
}

/**
 * O que fazer quando um `rename` falha (`tentativa` = quantas falhas já houve neste arquivo, contando esta).
 * `repetir`: arquivo em uso no Windows e ainda há repetição sobrando. `em-uso`: acabaram as repetições.
 * `outra`: qualquer outro erro, ou qualquer erro fora do Windows (lá o `rename` troca arquivo aberto sem problema).
 */
export function classificarFalhaDeTroca({ codigo, tentativa, plataforma }) {
  if (plataforma !== 'win32' || !CODIGOS_DE_ARQUIVO_EM_USO.has(codigo)) return 'outra'
  return tentativa <= MAXIMO_DE_REPETICOES ? 'repetir' : 'em-uso'
}

/** Espera antes da próxima repetição: 100, 200, 300, 400 e 500 ms (no máximo 1,5 s no total). */
export function esperaDaTentativa(tentativa) {
  return ESPERA_BASE_MS * tentativa
}

export function mensagemDeArquivoEmUso(arquivo) {
  return `O arquivo ${arquivo} está em uso por outro programa (um gancho do Claude Code, o servidor da Axon ou um teste). Feche esse programa e rode a montagem de novo. Nenhum arquivo ficou pela metade.`
}

/** A troca de um arquivo falhou porque outro programa o segura, mesmo depois de todas as repetições. */
export class ArquivoEmUsoError extends Error {
  code = 'ARQUIVO_EM_USO'

  constructor(arquivo, causa) {
    super(mensagemDeArquivoEmUso(arquivo), { cause: causa })
    this.arquivo = arquivo
  }
}

/** Mapas de código primeiro, programas por último: o `.mjs` novo só aparece depois do mapa que ele aponta. */
export function ordenarParaTroca(nomes) {
  const ehMapa = nome => nome.endsWith('.map')
  return [...nomes.filter(ehMapa), ...nomes.filter(nome => !ehMapa(nome))]
}

/**
 * Um `rename` que insiste enquanto a regra mandar. Sem arquivo pela metade: cada tentativa é inteira ou nada.
 * `tentativa` é quantas vezes já falhou, mais um (quem chama não passa).
 */
export async function renomearComTentativas(pedido, tentativa = 1) {
  const { origem, destino, renomear, esperar, plataforma } = pedido
  try {
    await renomear(origem, destino)
  } catch (erro) {
    const veredito = classificarFalhaDeTroca({ codigo: erro?.code, tentativa, plataforma })
    if (veredito === 'outra') throw erro
    if (veredito === 'em-uso') throw new ArquivoEmUsoError(destino, erro)
    await esperar(esperaDaTentativa(tentativa))
    await renomearComTentativas(pedido, tentativa + 1)
  }
}

/** Leva cada arquivo de `de` para `para`; no primeiro que não for possível trocar, para (os outros nem são tentados). */
export async function trocarArquivos({ de, para, nomes, renomear, esperar, plataforma }) {
  for (const nome of ordenarParaTroca(nomes)) {
    await renomearComTentativas({ origem: path.join(de, nome), destino: path.join(para, nome), renomear, esperar, plataforma })
  }
}

/** Apaga a pasta de trabalho. Não conseguir é aviso, não erro: não pode esconder o motivo de uma falha da montagem. */
export async function apagarPastaTemporaria(pasta, { apagar, avisar }) {
  try {
    await apagar(pasta)
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro)
    avisar(`Aviso: não consegui apagar a pasta temporária ${pasta} (${motivo}). Pode apagá-la à mão.`)
  }
}

/** Caminho curto para a mensagem final: relativo ao projeto, com barra normal; fora dele, o caminho inteiro. */
export function caminhoParaMostrar(raiz, arquivo) {
  const relativo = path.relative(raiz, arquivo)
  const fora = relativo === '..' || relativo.startsWith(`..${path.sep}`) || path.isAbsolute(relativo)
  return fora ? arquivo : relativo.split(path.sep).join('/')
}
