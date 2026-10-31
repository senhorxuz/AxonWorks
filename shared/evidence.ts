/**
 * Evidência verificável.
 *
 * A Axon Works não executa comandos e não roda testes. Ela nunca pode afirmar
 * que um teste passou. Pode, no entanto, afirmar três coisas diferentes e
 * jamais equivalentes:
 *
 * 1. `agent_reported`  — uma IA declarou um comando e um resultado. É relato.
 * 2. `cross_checked`   — outra identidade conferiu aquele relato e assinou uma
 *                        nota própria. Continua sendo relato, agora de dois.
 * 3. `artifact_bound`  — a evidência aponta arquivos concretos da pasta
 *                        cadastrada do projeto e a Axon calculou o SHA-256
 *                        deles. Isso é fato verificável pelo sistema.
 *
 * O frescor nunca é armazenado como verdade: é sempre recalculado na leitura.
 * Um hash guardado como "vigente" envelhece em silêncio e passa a mentir.
 */

export type EvidenceOutcome = 'passed' | 'failed' | 'not_run'

/** Toda evidência nasce como relato de agente. Este campo nunca muda. */
export type EvidenceProvenance = 'agent_report'

/** As três afirmações possíveis. `agent_reported` está sempre presente. */
export type EvidenceAssertion = 'agent_reported' | 'cross_checked' | 'artifact_bound'

/**
 * Estado de um artefato declarado por uma evidência, calculado na leitura.
 *
 * - `covers_current`: o arquivo existe e o SHA-256 continua igual ao gravado.
 * - `stale`:          o arquivo existe e o conteúdo mudou. A evidência
 *                     permanece no histórico, mas não cobre a versão atual.
 * - `missing`:        o arquivo não existe mais no caminho declarado.
 * - `unverifiable`:   não foi possível verificar sem violar as proteções de
 *                     leitura (projeto sem pasta cadastrada, caminho fora da
 *                     raiz, symlink para fora, erro de leitura).
 */
export type ArtifactFreshness = 'covers_current' | 'stale' | 'missing' | 'unverifiable'

/** Frescor agregado da evidência inteira. */
export type EvidenceFreshness = ArtifactFreshness | 'no_artifacts'

export interface EvidenceArtifactInput {
  /** Caminho relativo à pasta cadastrada do projeto. Nunca absoluto. */
  path: string
  /** SHA-256 em hexadecimal minúsculo, 64 caracteres. */
  sha256: string
  sizeBytes?: number
}

export interface EvidenceArtifact {
  id: string
  evidenceId: string
  path: string
  sha256: string
  sizeBytes: number | null
  observedAt: string
}

/** Artefato com o veredito de frescor calculado no momento da leitura. */
export interface EvidenceArtifactStatus extends EvidenceArtifact {
  freshness: ArtifactFreshness
  /** Hash atual do arquivo no disco, quando foi possível calcular. */
  currentSha256: string | null
  checkedAt: string
  /** Explicação legível em português. Nunca vazia. */
  reason: string
}

/**
 * Conferência cruzada. Registro imutável: nunca é editado nem removido.
 * A identidade que conferiu precisa ser diferente de quem relatou.
 */
export interface EvidenceVerification {
  id: string
  evidenceId: string
  verifiedBy: string
  note: string
  createdAt: string
}

/**
 * Evidência com identidade própria, ligada ao checkpoint que a originou.
 * O `evidence_json` do checkpoint permanece intocado como original imutável.
 */
export interface EvidenceRecord {
  id: string
  projectId: string
  checkpointId: string
  /** Posição dentro do checkpoint de origem, começando em 0. */
  position: number
  command: string
  outcome: EvidenceOutcome
  details: string
  /** Identidade declarada do agente que gravou o checkpoint. */
  reportedBy: string
  provenance: EvidenceProvenance
  createdAt: string
}

/** Evidência completa para leitura: relato, artefatos e conferências. */
export interface EvidenceView extends EvidenceRecord {
  artifacts: EvidenceArtifactStatus[]
  verifications: EvidenceVerification[]
  /** Sempre contém `agent_reported`. As demais entram quando se aplicam. */
  assertions: EvidenceAssertion[]
  freshness: EvidenceFreshness
  /** Frase pronta e honesta para a interface e para o Markdown. */
  explanation: string
}

export interface RegisterEvidenceArtifactsInput {
  actor: string
  artifacts: EvidenceArtifactInput[]
}

export interface CrossCheckEvidenceInput {
  verifiedBy: string
  note: string
}

export interface ListEvidenceOptions {
  taskId?: string
  checkpointId?: string
  /** Quando verdadeiro, devolve apenas evidências que deixaram de cobrir o código atual. */
  staleOnly?: boolean
  limit?: number
}

/**
 * Evidência declarada na gravação de um checkpoint.
 *
 * Substitui `Omit<Evidence, 'provenance'>` acrescentando os artefatos que
 * aquele comando afirma ter validado. Os artefatos entram na carga canônica
 * de idempotência: dois checkpoints que declaram o mesmo comando sobre
 * arquivos diferentes são checkpoints diferentes.
 */
export interface EvidenceInput {
  command: string
  outcome: EvidenceOutcome
  details: string
  artifacts?: EvidenceArtifactInput[]
}
