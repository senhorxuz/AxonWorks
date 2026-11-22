import type { Express } from 'express'
import type { AuthContext } from '../../shared/auth.js'
import { LICAO_MOTIVO_MAXIMO, LICAO_TEXTO_MAXIMO, type Licao, type TipoDeLicao } from '../../shared/licoes.js'
import type { WorkspaceStore } from '../store.js'
import { DomainError } from '../store/errors.js'
import type { EntradaDeLicao } from '../store/licoes.js'
import { asRecord, requireString, requireUuid } from '../store/validation.js'

const CAMINHO = '/api/projects/:id/licoes'
const DONO = 'Dono'

// O escopo do projeto (token restrito a outro projeto) é conferido antes, para toda rota /api/projects/:id,
// por `exigirEscopoDoProjeto` em server/auth/escopo.ts. Aqui fica só o que é desta rota: quem pode escrever.
function conferirDono(auth: AuthContext): void {
  if (auth.role !== 'owner' || auth.actorType === 'agent') {
    throw new DomainError(403, 'so_o_dono', 'Só o dono pode mudar as lições pela tela.')
  }
}

function incluirAposentadas(valor: unknown): boolean {
  if (valor === 'true') return true
  if (valor === 'false' || valor === undefined) return false
  throw new DomainError(400, 'invalid_input', 'Escolha se quer incluir as lições aposentadas.')
}

function dadosDaCriacao(body: unknown): EntradaDeLicao {
  const dados = asRecord(body, 'lição')
  if (dados.tipo !== 'regra' && dados.tipo !== 'verificacao') {
    throw new DomainError(400, 'invalid_input', 'Escolha entre regra e verificação.')
  }
  const texto = requireString(dados.texto, 'texto', 1, LICAO_TEXTO_MAXIMO)
  return {
    tipo: dados.tipo,
    texto,
    agent: DONO,
    fraseDoDono: texto,
    // O store valida o momento e a linha curta, inclusive quando chegam de um cliente HTTP.
    momento: dados.momento as EntradaDeLicao['momento'],
    linhaCurta: dados.linhaCurta as EntradaDeLicao['linhaCurta'],
  }
}

function motivoDoDono(body: unknown): string {
  const { motivo } = asRecord(body, 'aposentadoria')
  if (motivo === undefined || (typeof motivo === 'string' && motivo.trim() === '')) {
    throw new DomainError(400, 'pedido_do_dono_obrigatorio', 'Escreva o motivo para retirar a lição.')
  }
  return requireString(motivo, 'motivo', 1, LICAO_MOTIVO_MAXIMO)
}

function licaoDaRota(store: WorkspaceStore, projectId: string, licaoId: string, auth: AuthContext): Licao {
  conferirDono(auth)
  const id = requireUuid(licaoId, 'licaoId')
  const licao = store.getLicaoParaEscrita(projectId, id)
  if (auth.projectId && licao.projectId === null) {
    throw new DomainError(403, 'forbidden_project_scope', 'Este acesso vale somente para lições deste projeto.')
  }
  return licao
}

function dadosDaCorrecao(licao: Licao, body: unknown): EntradaDeLicao {
  const dados = asRecord(body, 'correção')
  const texto = requireString(dados.texto, 'texto', 1, LICAO_TEXTO_MAXIMO)
  return {
    texto,
    tipo: licao.tipo,
    agent: DONO,
    fraseDoDono: licao.tipo === 'erro' ? undefined : texto,
    momento: licao.momento ?? undefined,
    linhaCurta: dados.linhaCurta as EntradaDeLicao['linhaCurta'],
    substitui: licao.id,
  }
}

/** Registradas após a autenticação do app, que identifica as escritas locais como operador. */
export function ligarRotasDasLicoes(app: Express, store: WorkspaceStore): void {
  app.get(CAMINHO, (req, res) => {
    res.json(store.listarLicoes(req.params.id, {
      tipo: req.query.tipo as TipoDeLicao | undefined,
      incluirAposentadas: incluirAposentadas(req.query.incluirAposentadas),
    }))
  })

  app.post(CAMINHO, (req, res) => {
    conferirDono(req.auth!)
    res.status(201).json(store.registrarLicao(req.params.id, dadosDaCriacao(req.body)))
  })

  app.post(`${CAMINHO}/:licaoId/aposentar`, (req, res) => {
    const licao = licaoDaRota(store, req.params.id, req.params.licaoId, req.auth!)
    const motivo = motivoDoDono(req.body)
    res.json(store.aposentarLicao(licao.id, { agent: DONO, motivo, pedidoDoDono: motivo }))
  })

  app.post(`${CAMINHO}/:licaoId/corrigir`, (req, res) => {
    const licao = licaoDaRota(store, req.params.id, req.params.licaoId, req.auth!)
    res.status(201).json(store.registrarLicao(licao.projectId, dadosDaCorrecao(licao, req.body)))
  })
}
