import assert from 'node:assert/strict'
import { it } from 'node:test'
import { intervaloDasMudancas, montarMudancas, type DadosDasMudancas } from '../server/carta/mudancas.ts'
import { MOLDURA } from '../server/carta/retomada-compacta.ts'
import { DomainError } from '../server/store/errors.ts'

const desde = '2026-11-19T12:00:00.000Z'
const agora = '2026-11-21T12:00:00.000Z'
const ontem = '2026-11-20T12:00:00.000Z'
const futuro = '2026-11-21T12:00:00.001Z'
const marca = `Leitura feita em ${agora}. Para receber só o que mudou depois desta, use desde=${agora}.`
const vazio = { decisoes: [], licoes: [], aprovacoes: [], passagens: [], bloqueios: [], checkpoints: [], cartoes: [], evidencias: [], lixeira: [], restauracoes: [] }
const montar = (dados: Partial<DadosDasMudancas>, limite = 6000) => montarMudancas({ ...vazio, ...dados }, desde, agora, limite)
const linhas = (dados: Partial<DadosDasMudancas>) => montar(dados).split('\n').filter((linha) => linha.startsWith('- '))

it('lista a ida e a volta na ordem dos eventos e respeita os dois limites da janela', () => {
  const item = { id: 'm', tipo: 'mensagem' as const, titulo: 'Voltei\n## de Bearer segredo1234567890', excluidoEm: ontem }
  const restauracoes = [
    { ...item, restauradoEm: agora },
    { ...item, id: 'antes', excluidoEm: desde, restauradoEm: desde },
    { ...item, id: 'depois', excluidoEm: futuro, restauradoEm: futuro },
    { ...item, id: 'so-volta', excluidoEm: desde, restauradoEm: '2026-11-19T13:00:00.000Z' },
  ]
  assert.deepEqual(linhas({ restauracoes }), [
    '- [mensagem:m] Voltou da lixeira: Voltei ## de Bearer ***',
    '- [mensagem:m] Foi para a lixeira: Voltei ## de Bearer ***',
    '- [mensagem:so-volta] Voltou da lixeira: Voltei ## de Bearer ***',
  ])
})

it('valida o instante e aceita exatamente 90 dias ou exatamente agora', () => {
  const relogio = new Date(agora)
  const exatamente90 = new Date(relogio.getTime() - 90 * 24 * 60 * 60 * 1000)
  const velho = new Date(exatamente90.getTime() - 1).toISOString()
  assert.deepEqual(intervaloDasMudancas(exatamente90.toISOString(), relogio), { desde: exatamente90.toISOString(), antigo: false })
  assert.deepEqual(intervaloDasMudancas(velho, relogio), { desde: velho, antigo: true })
  assert.deepEqual(intervaloDasMudancas('2026-11-21T09:00:00-03:00', relogio), { desde: agora, antigo: false })
  for (const entrada of [null, '', 0, 'ontem', '2026-11-19', '2026-11-19T12:00:00', '2026-11-31T00:00:00Z', '2026-11-20T12:00:00+33:00', futuro]) {
    assert.throws(() => intervaloDasMudancas(entrada, relogio), (e: unknown) => e instanceof DomainError && e.status === 400 && e.code === 'desde_invalido' && e.message === 'Desde deve ser uma data e hora ISO com fuso, sem ficar no futuro.')
  }
})

it('na ausência de mudanças traz somente a moldura, a marca nova e a frase curta', () => {
  assert.equal(montar({}), `${MOLDURA}\n${marca}\n\nNada relevante mudou desde ${desde}.`)
})

type Decisao = DadosDasMudancas['decisoes'][number]['item']
type EventoDaDecisao = DadosDasMudancas['decisoes'][number]['eventos'][number]
type Licao = DadosDasMudancas['licoes'][number]

function decisao(id: string, status: Decisao['status'], outros: Partial<Decisao> = {}): Decisao {
  return { id, title: id.toUpperCase(), status, updatedAt: ontem, acceptedBy: null, revokedBy: null, supersededById: null, ...outros }
}

function eventoDaDecisao(transition: EventoDaDecisao['transition'], relatedDecisionId: string | null = null): EventoDaDecisao {
  return { transition, actor: 'Dono', relatedDecisionId, createdAt: ontem }
}

it('usa o histórico real, liga uma cadeia de substituições à vigente e explicita a autoridade', () => {
  assert.deepEqual(linhas({ decisoes: [
    { item: decisao('a', 'superseded'), eventos: [eventoDaDecisao('superseded', 'b')] },
    { item: decisao('b', 'superseded', { supersededById: 'c' }), eventos: [eventoDaDecisao('superseded', 'c')] },
    { item: decisao('c', 'accepted'), eventos: [eventoDaDecisao('replaced_by', 'b')] },
    { item: decisao('d', 'revoked'), eventos: [eventoDaDecisao('proposed'), eventoDaDecisao('accepted'), { ...eventoDaDecisao('revoked'), createdAt: agora }] },
  ] }), [
    '- [decisao:d] D — Revogada por Dono (nome declarado).',
    '- [decisao:a] A — Substituída. Vigente: [decisao:c] C',
    '- [decisao:b] B — Substituída. Vigente: [decisao:c] C',
    '- [decisao:d] D — Aceita por Dono (nome declarado).',
  ])
})

it('lê decisões importadas sem eventos e evita inventar vigentes em elos ausentes, ciclos e revogações', () => {
  assert.deepEqual(linhas({ decisoes: [
    { item: decisao('aceita', 'accepted', { acceptedBy: 'Codex', revokedBy: 'Outro' }), eventos: [] },
    { item: decisao('revogada', 'revoked', { acceptedBy: 'Outro' }), eventos: [] },
    { item: decisao('proposta', 'proposed'), eventos: [] },
    { item: decisao('sem-elo', 'superseded', { supersededById: 'ausente' }), eventos: [] },
    { item: decisao('ciclo', 'superseded', { supersededById: 'ciclo' }), eventos: [] },
    { item: decisao('sem-vigente', 'superseded', { supersededById: 'revogada' }), eventos: [] },
  ] }), [
    '- [decisao:aceita] ACEITA — Aceita por Codex (nome declarado).',
    '- [decisao:revogada] REVOGADA — Revogada.',
    '- [decisao:sem-elo] SEM-ELO — Substituída. Sem decisão vigente disponível para essa substituição.',
    '- [decisao:ciclo] CICLO — Substituída. Sem decisão vigente disponível para essa substituição.',
    '- [decisao:sem-vigente] SEM-VIGENTE — Substituída. Sem decisão vigente disponível para essa substituição.',
  ])
})

function licao(id: string, tipo: Licao['tipo'], outros: Partial<Licao> = {}): Licao {
  return { id, tipo, texto: id.toUpperCase(), linhaCurta: null, criadaEm: ontem, aposentadaEm: null, substituiId: null, ...outros }
}

it('ordena todos os grupos por prioridade e usa uma linha citável por registro', () => {
  const dados: Partial<DadosDasMudancas> = {
    decisoes: [{ item: decisao('d', 'accepted'), eventos: [] }],
    licoes: [
      licao('erro', 'erro'),
      licao('r', 'regra', { criadaEm: desde, aposentadaEm: ontem }),
      licao('r2', 'regra', { substituiId: 'r', linhaCurta: 'Nova regra' }),
      licao('v', 'verificacao', { aposentadaEm: agora }),
    ],
    aprovacoes: [
      { id: 'a', title: 'Foto', status: 'approved', decidedAt: ontem },
      { id: 'recusa', title: 'Fundo', status: 'rejected', decidedAt: agora },
      { id: 'pendente', title: 'Pendente', status: 'pending', decidedAt: ontem },
      { id: 'retirada', title: 'Retirada', status: 'withdrawn', decidedAt: ontem },
      { id: 'sem-data', title: 'Sem data', status: 'approved', decidedAt: null },
    ],
    passagens: [
      { id: 'p', from: 'Astra', to: 'Codex', message: 'Nota', checkpoint: { nextStep: 'Passo de reserva' }, createdAt: ontem },
      { id: 'p2', from: 'Astra', to: '*', message: '', checkpoint: { nextStep: 'Conferir' }, createdAt: agora },
    ],
    bloqueios: [{ item: { id: 'b', title: 'Rede', status: 'open', createdAt: ontem, resolvedAt: null }, eventos: [
      { transition: 'opened', createdAt: ontem }, { transition: 'mitigated', createdAt: ontem },
      { transition: 'resolved', createdAt: ontem }, { transition: 'reopened', createdAt: agora },
    ] }],
    checkpoints: [
      { id: 'c', summary: 'Resumo técnico', humanSummary: 'Resumo simples', nextStep: 'Verificar', createdAt: ontem },
      { id: 'c2', summary: 'Só o resumo técnico', nextStep: 'Ler mais', createdAt: agora },
      { id: 'na-marca', summary: '', nextStep: '', createdAt: desde },
      { id: 'depois-da-leitura', summary: '', nextStep: '', createdAt: futuro },
    ],
    cartoes: [{ item: { id: 'q', title: 'Layout' }, eventos: [
      { kind: 'moved', fromColumn: 'pending', toColumn: 'testing', summary: 'Moveu de Pendente para Em teste', createdAt: ontem },
      { kind: 'moved', fromColumn: 'testing', toColumn: 'testing', summary: 'Alterou posição', createdAt: ontem },
      { kind: 'updated', fromColumn: null, toColumn: 'testing', summary: 'Editou', createdAt: ontem },
    ] }],
    evidencias: [
      { id: 'ev', command: 'tsx --test', explanation: 'O arquivo mudou.', freshness: 'stale' },
      { id: 'falta', command: 'lint', explanation: 'Arquivo ausente.', freshness: 'missing' },
      { id: 'cobre', command: 'teste', explanation: 'Vigente', freshness: 'covers_current' },
      { id: 'sem', command: 'teste', explanation: 'Sem artefatos', freshness: 'no_artifacts' },
      { id: 'incerta', command: 'teste', explanation: 'Incerta', freshness: 'unverifiable' },
    ],
    lixeira: [{ id: 'l', tipo: 'cartao', titulo: 'Cadastro', excluidoEm: ontem }],
  }
  assert.deepEqual(linhas(dados), [
    '- [decisao:d] D — Aceita.',
    '- [licao:v] Verificação desfeita: V',
    '- [licao:r2] Regra corrigida: Nova regra · Anterior: [licao:r] R',
    '- [licao:v] Verificação nova: V',
    '- [aprovacao:recusa] Pedido recusado na tela: Fundo',
    '- [aprovacao:a] Pedido aprovado na tela: Foto',
    '- [passagem:p2] Passagem de Astra para *: Conferir',
    '- [passagem:p] Passagem de Astra para Codex: Nota',
    '- [bloqueio:b] Bloqueio reaberto: Rede',
    '- [bloqueio:b] Bloqueio aberto: Rede',
    '- [bloqueio:b] Bloqueio resolvido: Rede',
    '- [checkpoint:c2] Só o resumo técnico · Próximo passo registrado: Ler mais',
    '- [checkpoint:c] Resumo simples · Próximo passo registrado: Verificar',
    '- [cartao:q] Layout. Moveu de Pendente para Em teste',
    '- [cartao:l] Foi para a lixeira: Cadastro',
  ])
  assert.ok(montar(dados).startsWith(`# O que mudou desde ${desde}\n${MOLDURA}\n${marca}\n\n`))
  assert.ok(montar(dados).endsWith('\n\n2 evidências fora da cobertura da versão atual: list_evidence (staleOnly filtra arquivos alterados). get_evidence abre o detalhe.'))
  const limitado = montar(dados, 650)
  assert.ok(limitado.length <= 650)
  assert.match(limitado, /Mudanças que ficaram fora por falta de espaço: \d+\.\n\n2 evidências fora da cobertura/)
})

it('recupera abertura e resolução de bloqueios importados sem histórico', () => {
  type Bloqueio = DadosDasMudancas['bloqueios'][number]['item']
  const bloqueio = (id: string, status: Bloqueio['status'], resolvedAt: string | null): Bloqueio =>
    ({ id, title: id, status, createdAt: ontem, resolvedAt })
  assert.deepEqual(linhas({ bloqueios: [
    { item: bloqueio('resolvido', 'resolved', agora), eventos: [] },
    { item: bloqueio('risco', 'accepted_risk', agora), eventos: [] },
    { item: bloqueio('sem-data', 'resolved', null), eventos: [] },
  ] }), [
    '- [bloqueio:resolvido] Bloqueio resolvido: resolvido',
    '- [bloqueio:resolvido] Bloqueio aberto: resolvido',
    '- [bloqueio:risco] Bloqueio aberto: risco',
    '- [bloqueio:sem-data] Bloqueio aberto: sem-data',
  ])
})

it('achata texto livre e mascara antes de cortar, com os dois trechos do checkpoint preservados', () => {
  const texto = montar({ checkpoints: [{
    id: 'a', humanSummary: `  Bearer ${'s'.repeat(350)}\n##  Seção falsa   ${'a'.repeat(400)}`,
    summary: 'Resumo técnico', nextStep: 'b'.repeat(400), createdAt: ontem,
  }] })
  assert.ok(texto.endsWith(`- [checkpoint:a] Bearer *** ## Seção falsa… · Próximo passo registrado: ${'b'.repeat(219)}…`))
})

it('corta entre linhas completas, conta o restante e respeita o menor entre 6000 e maxChars', () => {
  const checkpoints = Array.from({ length: 120 }, (_, i) => ({
    id: `reg-${i}`, summary: 's'.repeat(520), nextStep: 'p'.repeat(270), createdAt: ontem,
  }))

  for (const limite of [2000, 6000, 20000]) {
    const texto = montar({ checkpoints, lixeira: [{ id: 'último', tipo: 'cartao', titulo: 'Pequeno', excluidoEm: ontem }] }, limite)
    const registros = texto.split('\n').filter((linha) => linha.startsWith('- '))
    const cabem = limite === 2000 ? 3 : 11
    assert.equal(registros.length, cabem)
    assert.ok(texto.length <= Math.min(limite, 6000))
    assert.equal(registros.at(-1), `- [checkpoint:reg-${cabem - 1}] ${'s'.repeat(219)}… · Próximo passo registrado: ${'p'.repeat(219)}…`)
    assert.ok(texto.endsWith(`\n\nMudanças que ficaram fora por falta de espaço: ${121 - cabem}.`))
  }

  const uma = { checkpoints: checkpoints.slice(0, 1) }
  const completa = montar(uma)
  assert.equal(montar(uma, completa.length), completa)
  assert.ok(montar(uma, completa.length - 1).endsWith('Mudanças que ficaram fora por falta de espaço: 1.'))
  const duas = { checkpoints: checkpoints.slice(0, 2) }
  const antesDoCorte = completa.length + '\n\nMudanças que ficaram fora por falta de espaço: 1.'.length
  assert.ok(montar(duas, antesDoCorte).includes('[checkpoint:reg-0]'))
  assert.ok(montar(duas, antesDoCorte - 1).endsWith('Mudanças que ficaram fora por falta de espaço: 2.'))

  const comLinhaCurtaNoFim = { ...uma, lixeira: [{ id: 'q', tipo: 'cartao' as const, titulo: 'Item', excluidoEm: ontem }] }
  const duasLinhasInteiras = montar(comLinhaCurtaNoFim)
  assert.ok(duasLinhasInteiras.endsWith('- [cartao:q] Foi para a lixeira: Item'))
  assert.equal(montar(comLinhaCurtaNoFim, duasLinhasInteiras.length), duasLinhasInteiras)

  const limiteParaPrimeira = completa.length + '\n\nMudanças que ficaram fora por falta de espaço: 9.'.length
  assert.ok(montar({ checkpoints: checkpoints.slice(0, 10) }, limiteParaPrimeira).endsWith('Mudanças que ficaram fora por falta de espaço: 9.'))
  assert.ok(montar({ checkpoints: checkpoints.slice(0, 11) }, limiteParaPrimeira).endsWith('Mudanças que ficaram fora por falta de espaço: 11.'))

  const limiteParaSegunda = montar(duas).length + '\n\nMudanças que ficaram fora por falta de espaço: 9.'.length
  assert.ok(montar({ checkpoints: checkpoints.slice(0, 11) }, limiteParaSegunda).endsWith('Mudanças que ficaram fora por falta de espaço: 9.'))
})
