import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  createProjectBundle,
  createProjectBundleV2,
  createProjectBundleV3,
  DEFAULT_BUDGET_CHARS,
  INSPECTION_DISCLAIMER_PTBR,
  inspectWorkspace,
  maskSecrets,
  MAX_BUNDLE_SERIALIZED_BYTES,
  MAX_FILE_READ_BYTES,
  MAX_INSPECTION_FILES,
  parseProjectBundle,
  PortabilityError,
  validateRelativeFilePath,
} from '../server/portability/index.js'
import { WorkspaceStore } from '../server/store.js'
import type { ProjectBundleV2, ProjectBundleV3 } from '../shared/portability.js'
import type { ProjectDetail } from '../shared/types.js'

let cleanups: Array<() => void> = []

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) {
    try {
      dispose()
    } catch {
      /* limpeza de pasta temporária */
    }
  }
})

describe('ProjectBundle v2: resoluções de mensagens', () => {
  function makeBundleWithResolution() {
    const detail = makeValidDetail()
    const question = {
      ...detail.messages[0]!,
      kind: 'question' as const,
      from: 'Astra',
      to: 'Grok',
      body: 'Qual caminho devemos seguir?',
    }
    const response = {
      id: randomUUID(),
      projectId: detail.project.id,
      from: 'Grok',
      to: 'Astra',
      kind: 'note' as const,
      body: 'Siga pelo caminho documentado.',
      createdAt: detail.project.updatedAt,
    }
    detail.messages = [question, response]
    detail.checkpoints[0] = { ...detail.checkpoints[0]!, agent: 'Grok' }

    return createProjectBundleV2({
      project: detail,
      backlogItems: [],
      deliveries: [],
      deliveryReceipts: [],
      messageResolutions: [
        {
          projectId: detail.project.id,
          messageId: question.id,
          agent: 'Grok',
          note: 'Resolvido sem expor PASSWORD=hunter2',
          responseMessageId: response.id,
          checkpointId: detail.checkpoints[0]!.id,
          resolvedAt: detail.project.updatedAt,
        },
      ],
    })
  }

  it('exporta e parseia resoluções sanitizadas sem transformá-las em recibos', () => {
    const bundle = makeBundleWithResolution()

    assert.equal(bundle.messageResolutions?.length, 1)
    assert.equal(bundle.messageResolutions?.[0]?.note.includes('hunter2'), false)
    assert.ok(bundle.messageResolutions?.[0]?.note.includes('PASSWORD=***'))
    assert.equal(bundle.deliveryReceipts.length, 0)

    const parsed = parseProjectBundle(bundle)
    assert.equal(parsed.version, 2)
    assert.deepEqual(parsed.messageResolutions, bundle.messageResolutions)
  })

  it('normaliza bundle v2 legado sem messageResolutions para lista vazia', () => {
    const current = makeBundleWithResolution()
    const { messageResolutions: _removed, ...legacyV2 } = current

    const parsed = parseProjectBundle(legacyV2)

    assert.equal(parsed.version, 2)
    assert.deepEqual(parsed.messageResolutions, [])
  })

  it('aceita destinatário broadcast e exige nota ou referência concreta', () => {
    const bundle = makeBundleWithResolution()
    const original = bundle.project.messages.find(
      (message) => message.id === bundle.messageResolutions?.[0]?.messageId,
    )!
    original.to = '*'
    bundle.messageResolutions![0] = {
      ...bundle.messageResolutions![0]!,
      agent: 'Gemini',
      note: 'Resolvida por quem recebeu o broadcast.',
      responseMessageId: null,
      checkpointId: null,
    }
    assert.doesNotThrow(() => parseProjectBundle(bundle))

    bundle.messageResolutions![0] = {
      ...bundle.messageResolutions![0]!,
      note: '   ',
    }
    assert.throws(
      () => parseProjectBundle(bundle),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.code, 'invalid_bundle_reference')
        return true
      },
    )
  })

  it('rejeita resolução de outro projeto, mensagem ausente, tipo comum ou agente sem destino', () => {
    const base = makeBundleWithResolution()
    const cases: ProjectBundleV2[] = [
      {
        ...base,
        messageResolutions: [
          { ...base.messageResolutions![0]!, projectId: randomUUID() },
        ],
      },
      {
        ...base,
        messageResolutions: [
          { ...base.messageResolutions![0]!, messageId: randomUUID() },
        ],
      },
      {
        ...base,
        messageResolutions: [
          { ...base.messageResolutions![0]!, agent: 'Gemini' },
        ],
      },
      {
        ...base,
        project: {
          ...base.project,
          messages: base.project.messages.map((message) =>
            message.id === base.messageResolutions![0]!.messageId
              ? { ...message, kind: 'note' }
              : message,
          ),
        },
      },
    ]

    for (const bundle of cases) {
      assert.throws(
        () => parseProjectBundle(bundle),
        (err: unknown) => {
          assert.ok(err instanceof PortabilityError)
          assert.equal(err.code, 'invalid_bundle_reference')
          return true
        },
      )
    }
  })

  it('rejeita resposta ou checkpoint inexistente e referência assinada por outro agente', () => {
    const base = makeBundleWithResolution()
    const responseId = base.messageResolutions![0]!.responseMessageId!
    const cases: ProjectBundleV2[] = [
      {
        ...base,
        messageResolutions: [
          { ...base.messageResolutions![0]!, responseMessageId: randomUUID() },
        ],
      },
      {
        ...base,
        messageResolutions: [
          { ...base.messageResolutions![0]!, checkpointId: randomUUID() },
        ],
      },
      {
        ...base,
        project: {
          ...base.project,
          messages: base.project.messages.map((message) =>
            message.id === responseId ? { ...message, from: 'OutroAgente' } : message,
          ),
        },
      },
      {
        ...base,
        project: {
          ...base.project,
          checkpoints: base.project.checkpoints.map((checkpoint) =>
            checkpoint.id === base.messageResolutions![0]!.checkpointId
              ? { ...checkpoint, agent: 'OutroAgente' }
              : checkpoint,
          ),
        },
      },
    ]

    for (const bundle of cases) {
      assert.throws(
        () => parseProjectBundle(bundle),
        (err: unknown) => {
          assert.ok(err instanceof PortabilityError)
          assert.equal(err.code, 'invalid_bundle_reference')
          return true
        },
      )
    }
  })

  it('rejeita data inválida e duplicidade normalizada por mensagem e agente', () => {
    const base = makeBundleWithResolution()
    const invalidDate: ProjectBundleV2 = {
      ...base,
      messageResolutions: [
        { ...base.messageResolutions![0]!, resolvedAt: 'ontem' },
      ],
    }
    assert.throws(
      () => parseProjectBundle(invalidDate),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.code, 'invalid_bundle')
        return true
      },
    )

    const duplicate: ProjectBundleV2 = {
      ...base,
      messageResolutions: [
        base.messageResolutions![0]!,
        { ...base.messageResolutions![0]!, agent: '  Grok  ' },
      ],
    }
    assert.throws(
      () => parseProjectBundle(duplicate),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.code, 'duplicate_message_resolution')
        return true
      },
    )
  })
})

function createTempDir(prefix = 'axon-portability-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* já removido */
    }
  })
  return dir
}

function makeValidDetail(overrides?: Partial<ProjectDetail>): ProjectDetail {
  const projectId = randomUUID()
  const taskId = randomUUID()
  const now = new Date('2026-09-14T12:00:00.000Z').toISOString()

  return {
    project: {
      id: projectId,
      name: 'Projeto de Teste',
      objective: 'Objetivo principal para testes de portabilidade',
      workspacePath: 'D:\\projetos\\workspace-exemplo',
      createdAt: now,
      updatedAt: now,
      revision: 1,
      ...overrides?.project,
    },
    tasks: overrides?.tasks ?? [
      {
        id: taskId,
        projectId,
        title: 'Tarefa Inicial',
        status: 'todo',
        assignee: 'Grok',
        leaseUntil: null,
        version: 0,
        blockedReason: null,
        completionCheckpointId: null,
        workIntent: null,
        createdAt: now,
      },
    ],
    checkpoints: overrides?.checkpoints ?? [
      {
        id: randomUUID(),
        projectId,
        taskId,
        agent: 'Gemini',
        summary: 'Resumo do checkpoint de teste',
        nextStep: 'Próximo passo planejado',
        blockers: ['Nenhum bloqueio'],
        decisions: ['Decisão inicial aprovada'],
        evidence: [
          {
            command: 'npm test',
            outcome: 'passed',
            details: 'Todos os testes passaram',
            provenance: 'agent_report',
          },
        ],
        revision: 1,
        createdAt: now,
      },
    ],
    messages: overrides?.messages ?? [
      {
        id: randomUUID(),
        projectId,
        from: 'Gemini',
        to: 'Astra',
        kind: 'note',
        body: 'Nota informativa entre agentes',
        createdAt: now,
      },
    ],
  }
}

describe('Módulo de Portabilidade: createProjectBundle e parseProjectBundle', () => {
  it('cria pacote de projeto válido com cabeçalho axon-project v1 e dados sanitizados', () => {
    const detail = makeValidDetail()
    const bundle = createProjectBundle(detail)

    assert.equal(bundle.format, 'axon-project')
    assert.equal(bundle.version, 1)
    assert.ok(typeof bundle.exportedAt === 'string')
    assert.ok(!isNaN(Date.parse(bundle.exportedAt)))
    assert.equal(bundle.project.project.id, detail.project.id)
    assert.equal(bundle.project.tasks.length, 1)
    assert.equal(bundle.project.checkpoints.length, 1)
    assert.equal(bundle.project.messages.length, 1)
  })

  it('assegura invariante de provenance=agent_report em todas as evidências', () => {
    const detail = makeValidDetail()
    // Força tentativa de adulterar provenance
    ;(detail.checkpoints[0].evidence[0] as any).provenance = 'verified'
    const bundle = createProjectBundle(detail)

    assert.equal(bundle.project.checkpoints[0].evidence[0].provenance, 'agent_report')
  })

  it('mascara segredos em textos do usuário no bundle exportado', () => {
    const detail = makeValidDetail()
    detail.project.objective = 'Conectar com Bearer secret-token-123 e senha PASSWORD=mypassword'
    detail.checkpoints[0].summary = 'Usando chave https://admin:secret@api.com/v1 e OPENAI_API_KEY=sk-abcdef123456'

    const bundle = createProjectBundle(detail)

    assert.ok(bundle.project.project.objective.includes('Bearer ***'))
    assert.ok(bundle.project.project.objective.includes('PASSWORD=***'))
    assert.ok(!bundle.project.project.objective.includes('secret-token-123'))
    assert.ok(bundle.project.checkpoints[0].summary.includes('://***:***@'))
    assert.ok(bundle.project.checkpoints[0].summary.includes('OPENAI_API_KEY=***'))
  })

  it('rejeita criação de pacote que excede 1 MB serializado', () => {
    const detail = makeValidDetail()
    // Cria mensagens volumosas que ultrapassam 1 MB
    const largeBody = 'A'.repeat(10000)
    detail.messages = []
    for (let i = 0; i < 110; i++) {
      detail.messages.push({
        id: randomUUID(),
        projectId: detail.project.id,
        from: 'AgentA',
        to: 'AgentB',
        kind: 'note',
        body: largeBody,
        createdAt: new Date().toISOString(),
      })
    }

    assert.throws(
      () => createProjectBundle(detail),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'bundle_too_large')
        return true
      },
    )
  })

  it('parseia pacote válido gerado pelo criador em ciclo de ida e volta (roundtrip)', () => {
    const detail = makeValidDetail()
    const bundle = createProjectBundle(detail)
    const parsed = parseProjectBundle(bundle)

    assert.deepEqual(parsed.project.project.id, bundle.project.project.id)
    assert.equal(parsed.format, 'axon-project')
    assert.equal(parsed.version, 1)
  })

  it('rejeita pacote com formato desconhecido ou ausente', () => {
    const detail = makeValidDetail()
    const bundle: any = createProjectBundle(detail)
    bundle.format = 'outro-formato'

    assert.throws(
      () => parseProjectBundle(bundle),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle')
        return true
      },
    )
  })

  it('rejeita pacote com versão incompatível', () => {
    const detail = makeValidDetail()
    const bundle: any = createProjectBundle(detail)
    bundle.version = 2

    assert.throws(
      () => parseProjectBundle(bundle),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle')
        return true
      },
    )
  })

  it('rejeita pacote com inconsistência relacional (taskId do checkpoint inexistente na lista de tasks)', () => {
    const detail = makeValidDetail()
    const bundle = createProjectBundle(detail)
    // Altera taskId do checkpoint para UUID não presente na lista de tasks
    bundle.project.checkpoints[0].taskId = randomUUID()

    assert.throws(
      () => parseProjectBundle(bundle),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle_reference')
        return true
      },
    )
  })

  it('rejeita pacote com projectId divergente em tarefas', () => {
    const detail = makeValidDetail()
    const bundle = createProjectBundle(detail)
    bundle.project.tasks[0].projectId = randomUUID()

    assert.throws(
      () => parseProjectBundle(bundle),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle_reference')
        return true
      },
    )
  })

  it('rejeita IDs duplicados em tarefas ou checkpoints', () => {
    const detail = makeValidDetail()
    const dupTask = { ...detail.tasks[0] }
    detail.tasks.push(dupTask)

    assert.throws(
      () => createProjectBundle(detail),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'duplicate_task_id')
        return true
      },
    )
  })

  it('aceita tarefa concluída somente quando o checkpoint de conclusão pertence à própria tarefa', () => {
    const detail = makeValidDetail()
    const task = detail.tasks[0]!
    const checkpoint = detail.checkpoints[0]!
    task.status = 'done'
    task.assignee = null
    task.completionCheckpointId = checkpoint.id

    const bundle = createProjectBundle(detail)
    const parsed = parseProjectBundle(bundle)

    assert.equal(parsed.project.tasks[0]?.status, 'done')
    assert.equal(parsed.project.tasks[0]?.completionCheckpointId, checkpoint.id)
    assert.equal(parsed.project.checkpoints[0]?.taskId, task.id)
  })

  it('rejeita tarefa concluída sem checkpoint de conclusão ou com referência inexistente', () => {
    for (const completionCheckpointId of [null, randomUUID()]) {
      const detail = makeValidDetail()
      detail.tasks[0] = {
        ...detail.tasks[0]!,
        status: 'done',
        assignee: null,
        completionCheckpointId,
      }

      assert.throws(
        () => createProjectBundle(detail),
        (err: unknown) => {
          assert.ok(err instanceof PortabilityError)
          assert.equal(err.status, 400)
          assert.equal(err.code, 'invalid_bundle_reference')
          return true
        },
      )
    }
  })

  it('rejeita checkpoint de conclusão ligado a outra tarefa', () => {
    const detail = makeValidDetail()
    const completedTask = detail.tasks[0]!
    const otherTaskId = randomUUID()
    detail.tasks.push({
      ...completedTask,
      id: otherTaskId,
      title: 'Outra tarefa',
      status: 'todo',
      assignee: null,
      completionCheckpointId: null,
    })
    completedTask.status = 'done'
    completedTask.assignee = null
    completedTask.completionCheckpointId = detail.checkpoints[0]!.id
    detail.checkpoints[0]!.taskId = otherTaskId

    assert.throws(
      () => createProjectBundle(detail),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle_reference')
        return true
      },
    )
  })

  it('rejeita checkpoint de conclusão em tarefa que não está concluída', () => {
    for (const status of ['todo', 'in_progress', 'blocked'] as const) {
      const detail = makeValidDetail()
      detail.tasks[0] = {
        ...detail.tasks[0]!,
        status,
        blockedReason: status === 'blocked' ? 'Aguardando resposta.' : null,
        completionCheckpointId: detail.checkpoints[0]!.id,
      }

      assert.throws(
        () => createProjectBundle(detail),
        (err: unknown) => {
          assert.ok(err instanceof PortabilityError)
          assert.equal(err.status, 400)
          assert.equal(err.code, 'invalid_bundle_reference')
          return true
        },
      )
    }
  })

  it('rejeita entrada não-objeto ou nula no parsing', () => {
    assert.throws(
      () => parseProjectBundle(null),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle')
        return true
      },
    )
    assert.throws(
      () => parseProjectBundle('string-invalida'),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle')
        return true
      },
    )
  })
})

describe('Módulo de Inspeção Seletiva de Workspace: Segurança de Caminhos e Traversal', () => {
  it('rejeita tentativas de path traversal relativo estilo Unix e Windows', async () => {
    const root = createTempDir('axon-traversal-')
    writeFileSync(join(root, 'arquivo-valido.txt'), 'conteudo seguro')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: [
        '../fora.txt',
        '..\\fora.txt',
        'sub/../../fora.txt',
        'sub/..\\../fora.txt',
      ],
    })

    assert.equal(inspection.files.length, 4)
    for (const f of inspection.files) {
      assert.equal(f.content, null)
      assert.ok(f.warning && f.warning.includes('traversal'))
    }
    assert.ok(inspection.warnings.length >= 4)
  })

  it('rejeita caminhos absolutos Linux e Windows na lista de arquivos', async () => {
    const root = createTempDir('axon-abs-')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: [
        '/etc/passwd',
        'C:\\Windows\\System32\\cmd.exe',
        '\\Root\\file.txt',
        'D:/projetos/outro.txt',
      ],
    })

    for (const f of inspection.files) {
      assert.equal(f.content, null)
      assert.ok(f.warning && f.warning.includes('absolutos'))
    }
  })

  it('rejeita caminhos UNC e caminhos de dispositivo Windows', async () => {
    const root = createTempDir('axon-unc-')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: [
        '\\\\servidor\\share\\documento.txt',
        '//servidor/share/documento.txt',
        '\\\\?\\C:\\arquivo.txt',
        '\\\\.\\COM1',
      ],
    })

    for (const f of inspection.files) {
      assert.equal(f.content, null)
      assert.ok(f.warning && (f.warning.includes('UNC') || f.warning.includes('proibidos')))
    }
  })

  it('rejeita Alternate Data Streams (ADS) do Windows', async () => {
    const root = createTempDir('axon-ads-')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: [
        'arquivo.txt:stream',
        'arquivo.txt::$DATA',
        'pasta:hidden',
      ],
    })

    for (const f of inspection.files) {
      assert.equal(f.content, null)
      assert.ok(f.warning && f.warning.includes('ADS'))
    }
  })

  it('rejeita injeção de byte nulo e caracteres de controle em caminhos', async () => {
    const root = createTempDir('axon-nullbyte-')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: [
        'arquivo.txt\0.js',
        'teste\x01.txt',
      ],
    })

    for (const f of inspection.files) {
      assert.equal(f.content, null)
      assert.ok(f.warning && f.warning.includes('controle'))
    }
  })

  it('rejeita nomes de dispositivos reservados no Windows', async () => {
    const root = createTempDir('axon-win-dev-')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: ['CON', 'PRN', 'AUX', 'NUL', 'COM1.txt', 'LPT1'],
    })

    for (const f of inspection.files) {
      assert.equal(f.content, null)
      assert.ok(f.warning && f.warning.includes('dispositivo reservado'))
    }
  })
})

describe('Módulo de Inspeção: Blacklist de Segurança e Arquivos Protegidos', () => {
  it('bloqueia acesso a .git, node_modules e .axon', async () => {
    const root = createTempDir('axon-blacklist-')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: [
        '.git/config',
        'node_modules/express/index.js',
        '.axon/workspace.sqlite',
      ],
    })

    for (const f of inspection.files) {
      assert.equal(f.content, null)
      assert.ok(f.warning && f.warning.includes('proibido pela blacklist'))
    }
  })

  it('bloqueia arquivos de variáveis de ambiente (.env, .env.local, .env.production)', async () => {
    const root = createTempDir('axon-env-')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: [
        '.env',
        '.env.local',
        '.env.production',
        'config/.env.test',
      ],
    })

    for (const f of inspection.files) {
      assert.equal(f.content, null)
      assert.ok(f.warning && f.warning.includes('.env'))
    }
  })

  it('bloqueia certificados, chaves criptográficas e bancos sqlite', async () => {
    const root = createTempDir('axon-keys-')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: [
        'certs/server.pem',
        'certs/server.key',
        'certs/ca.crt',
        'database.sqlite',
        'data.sqlite3',
        'local.db',
      ],
    })

    for (const f of inspection.files) {
      assert.equal(f.content, null)
      assert.ok(f.warning && f.warning.includes('Extensão de arquivo proibida'))
    }
  })

  it('bloqueia arquivos de credenciais conhecidos (id_rsa, credentials.json, .npmrc)', async () => {
    const root = createTempDir('axon-creds-')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: [
        'id_rsa',
        'id_ed25519',
        'credentials.json',
        '.npmrc',
        '.pypirc',
      ],
    })

    for (const f of inspection.files) {
      assert.equal(f.content, null)
      assert.ok(f.warning && f.warning.includes('credenciais'))
    }
  })
})

describe('Módulo de Inspeção: Fuga por Link Simbólico (Link Escape)', () => {
  it('detecta e rejeita link simbólico que aponta para arquivo fora do workspace', async () => {
    const outerDir = createTempDir('axon-outer-')
    const secretFile = join(outerDir, 'segredo-externo.txt')
    writeFileSync(secretFile, 'DADO_EXTERNO_ULTRACONFIDENCIAL')

    const wsDir = createTempDir('axon-ws-symlink-')
    const symlinkPath = join(wsDir, 'link-perigoso.txt')

    try {
      symlinkSync(secretFile, symlinkPath, 'file')
    } catch {
      // No Windows sem privilégios de desenvolvedor symlink pode lançar EPERM;
      // se falhar ao criar o symlink do sistema, ignoramos a criação física
      return
    }

    const inspection = await inspectWorkspace({
      workspacePath: wsDir,
      files: ['link-perigoso.txt'],
    })

    assert.equal(inspection.files.length, 1)
    assert.equal(inspection.files[0].content, null)
    assert.ok(inspection.files[0].warning?.includes('link simbólico'))
    assert.ok(!inspection.markdown.includes('DADO_EXTERNO_ULTRACONFIDENCIAL'))
  })
})

describe('Módulo de Inspeção: Arquivo Binário e Arquivo Grande', () => {
  it('detecta arquivo binário por byte nulo e oculta o conteúdo bruto', async () => {
    const root = createTempDir('axon-binary-')
    const binFile = join(root, 'arquivo.bin')
    const binData = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64])
    writeFileSync(binFile, binData)

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: ['arquivo.bin'],
    })

    assert.equal(inspection.files.length, 1)
    const file = inspection.files[0]
    assert.equal(file.isBinary, true)
    assert.equal(file.content, null)
    assert.equal(file.sizeBytes, 11)
    assert.equal(file.charCount, 0)
    assert.ok(file.warning?.includes('binário'))
    assert.ok(inspection.markdown.includes('[Conteúdo binário não exibido'))
  })

  it('respeita limite máximo de leitura de 128 KB por arquivo e sinaliza truncamento', async () => {
    const root = createTempDir('axon-large-')
    const largeFile = join(root, 'grande.txt')
    // Cria arquivo de 160 KB (maior que 128 KB = 131.072 bytes)
    const content = 'X'.repeat(160 * 1024)
    writeFileSync(largeFile, content)

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: ['grande.txt'],
      maxChars: 50000,
    })

    assert.equal(inspection.files.length, 1)
    const file = inspection.files[0]
    assert.equal(file.sizeBytes, 160 * 1024)
    assert.equal(file.isTruncated, true)
    assert.ok(file.warning?.includes('128 KB'))
    assert.ok(file.warning?.includes('orçamento'))
    // Leitura limitada aos primeiros 128 KB
    assert.ok(file.charCount <= MAX_FILE_READ_BYTES)
  })

  it('compõe avisos quando arquivo excede 128 KB e orçamento já está esgotado', async () => {
    const root = createTempDir('axon-large-exhausted-')
    writeFileSync(join(root, 'primeiro.txt'), 'P'.repeat(2000))
    writeFileSync(join(root, 'grande.txt'), 'X'.repeat(160 * 1024))

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: ['primeiro.txt', 'grande.txt'],
      maxChars: 2000,
    })

    assert.equal(inspection.files.length, 2)
    const file = inspection.files[1]
    assert.equal(file.isTruncated, true)
    assert.ok(file.warning?.includes('128 KB'))
    assert.ok(file.warning?.includes('orçamento'))
    assert.equal(inspection.summary.truncated, true)
    assert.ok(inspection.warnings.some((w) => w.includes('128 KB')))
    assert.ok(inspection.warnings.some((w) => w.includes('esgotado') || w.includes('orçamento')))
  })

  it('não vaza paths absolutos externos nem stack traces em warnings de leitura', async () => {
    const root = createTempDir('axon-no-leak-')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: ['arquivo-inexistente.txt'],
    })

    assert.equal(inspection.files.length, 1)
    const warn = inspection.warnings[0] ?? ''
    assert.ok(!warn.includes(root), 'warning não deve conter o caminho raiz absoluto do host')
    assert.ok(!warn.includes('at '), 'warning não deve conter stack trace')
    assert.ok(!warn.includes('ENOENT: no such file'), 'warning não deve vazar mensagem interna do fs')
    assert.ok(warn.includes('arquivo-inexistente.txt'))
  })
})

describe('Módulo de Inspeção: Orçamento de Caracteres e Relatório PT-BR', () => {
  it('aplica orçamento global de caracteres e trunca arquivos subsequentes com aviso', async () => {
    const root = createTempDir('axon-budget-')
    writeFileSync(join(root, 'a.txt'), 'A'.repeat(1500))
    writeFileSync(join(root, 'b.txt'), 'B'.repeat(1500))

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: ['a.txt', 'b.txt'],
      maxChars: 2000, // Limite mínimo permitido
    })

    assert.equal(inspection.summary.budgetMaxChars, 2000)
    assert.equal(inspection.summary.budgetUsedChars, 2000)
    assert.equal(inspection.summary.truncated, true)

    // a.txt usou 1500 caracteres, b.txt deve ter recebido no máximo 500 e estar truncado
    assert.equal(inspection.files[0].content?.length, 1500)
    assert.equal(inspection.files[1].content?.length, 500)
    assert.equal(inspection.files[1].isTruncated, true)
    assert.ok(inspection.warnings.some((w) => w.includes('orçamento global') || w.includes('truncado')))
  })

  it('rejeita maxChars fora do intervalo permitido (2000 a 50000)', async () => {
    const root = createTempDir('axon-invalid-budget-')

    await assert.rejects(
      () => inspectWorkspace({ workspacePath: root, files: [], maxChars: 1000 }),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_max_chars')
        return true
      },
    )

    await assert.rejects(
      () => inspectWorkspace({ workspacePath: root, files: [], maxChars: 60000 }),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_max_chars')
        return true
      },
    )
  })

  it('rejeita requisição com mais de 20 arquivos', async () => {
    const root = createTempDir('axon-too-many-')
    const filesList = Array.from({ length: 21 }, (_, i) => `arq-${i}.txt`)

    await assert.rejects(
      () => inspectWorkspace({ workspacePath: root, files: filesList }),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'too_many_files')
        return true
      },
    )
  })

  it('inclui disclaimer PT-BR obrigatório e distingue bytes e caracteres no relatório', async () => {
    const root = createTempDir('axon-ptbr-')
    writeFileSync(join(root, 'exemplo.txt'), 'Linha 1 com dados\nLinha 2 com Bearer token-secreto-xyz')

    const inspection = await inspectWorkspace({
      workspacePath: root,
      files: ['exemplo.txt'],
    })

    // Disclaimer em PT-BR presente
    assert.ok(inspection.disclaimer.includes('AVISO DE SEGURANÇA E DADO NÃO CONFIÁVEL'))
    assert.ok(inspection.disclaimer.includes('Dado não confiável'))
    assert.ok(inspection.disclaimer.includes('Máscara de segredos'))
    assert.ok(inspection.disclaimer.includes('NUNCA são autoimportados'))

    // Distinção de bytes e caracteres
    assert.ok(inspection.summary.totalBytes > 0)
    assert.ok(inspection.summary.totalChars > 0)
    assert.ok(inspection.markdown.includes('Tamanho total em disco'))
    assert.ok(inspection.markdown.includes('Total de caracteres lidos'))

    // Mascaramento aplicado no conteúdo inspecionado
    assert.ok(inspection.files[0].content?.includes('Bearer ***'))
    assert.ok(!inspection.files[0].content?.includes('token-secreto-xyz'))
  })
})

describe('ProjectBundle v2: backlog, passagens e recibos', () => {
  it('exporta v2 com backlog, deliveries e receipts sanitizados', () => {
    const detail = makeValidDetail()
    const taskId = detail.tasks[0]!.id
    const checkpointId = detail.checkpoints[0]!.id
    const deliveryId = randomUUID()
    const backlogId = randomUUID()
    const bundle = createProjectBundleV2({
      project: detail,
      backlogItems: [
        {
          id: backlogId,
          projectId: detail.project.id,
          title: 'Ideia com OPENAI_API_KEY=sk-backlog-secret',
          description: 'Bearer token-backlog-xyz',
          priority: 'high',
          stage: 'idea',
          createdBy: 'Agente API_KEY=abc123',
          promotedTaskId: null,
          version: 0,
          createdAt: detail.project.createdAt,
          updatedAt: detail.project.updatedAt,
        },
      ],
      deliveries: [
        {
          id: deliveryId,
          projectId: detail.project.id,
          checkpointId,
          taskId,
          from: 'Gemini',
          to: 'Grok',
          message: 'Siga com PASSWORD=hunter2 e https://admin:leak@host/path',
          createdAt: detail.project.createdAt,
        },
      ],
      deliveryReceipts: [
        {
          projectId: detail.project.id,
          deliveryId,
          agent: 'Grok',
          acknowledgedAt: detail.project.updatedAt,
        },
      ],
    })

    assert.equal(bundle.format, 'axon-project')
    assert.equal(bundle.version, 2)
    assert.equal(bundle.backlogItems.length, 1)
    assert.equal(bundle.deliveries.length, 1)
    assert.equal(bundle.deliveryReceipts.length, 1)
    assert.equal(bundle.backlogItems[0]?.title.includes('sk-backlog-secret'), false)
    assert.ok(bundle.backlogItems[0]?.title.includes('OPENAI_API_KEY=***'))
    assert.ok(bundle.backlogItems[0]?.description.includes('Bearer ***'))
    assert.equal(bundle.backlogItems[0]?.description.includes('token-backlog-xyz'), false)
    assert.ok(bundle.backlogItems[0]?.createdBy.includes('API_KEY=***'))
    assert.equal(bundle.deliveries[0]?.message.includes('hunter2'), false)
    assert.ok(bundle.deliveries[0]?.message.includes('PASSWORD=***'))
    assert.ok(bundle.deliveries[0]?.message.includes('://***:***@'))
    assert.equal('acknowledgedAt' in bundle.deliveries[0]!, false)
    assert.equal('checkpoint' in bundle.deliveries[0]!, false)
    assert.equal('task' in bundle.deliveries[0]!, false)
  })

  it('parseia v1 legado sem arrays adicionais', () => {
    const v1 = createProjectBundle(makeValidDetail())
    const legacyTask = v1.project.tasks[0] as unknown as Record<string, unknown>
    delete legacyTask.blockedReason
    delete legacyTask.completionCheckpointId
    delete legacyTask.workIntent
    const parsed = parseProjectBundle(v1)
    assert.equal(parsed.version, 1)
    assert.equal('backlogItems' in parsed, false)
    assert.equal('deliveries' in parsed, false)
    assert.equal(parsed.project.tasks[0]?.completionCheckpointId, null)
  })

  it('rejeita v2 com recibo de delivery inexistente, autor divergente e duplicatas', () => {
    const detail = makeValidDetail()
    const base = createProjectBundleV2({
      project: detail,
      backlogItems: [],
      deliveries: [
        {
          id: randomUUID(),
          projectId: detail.project.id,
          checkpointId: detail.checkpoints[0]!.id,
          taskId: detail.tasks[0]!.id,
          from: 'Gemini',
          to: 'Grok',
          message: 'ok',
          createdAt: detail.project.createdAt,
        },
      ],
      deliveryReceipts: [],
    })

    const missingReceipt: ProjectBundleV2 = {
      ...base,
      deliveryReceipts: [
        {
          projectId: detail.project.id,
          deliveryId: randomUUID(),
          agent: 'Grok',
          acknowledgedAt: detail.project.updatedAt,
        },
      ],
    }
    assert.throws(
      () => parseProjectBundle(missingReceipt),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle_reference')
        return true
      },
    )

    const authorMismatch: ProjectBundleV2 = {
      ...base,
      deliveries: [{ ...base.deliveries[0]!, from: 'OutroAutor' }],
    }
    assert.throws(
      () => parseProjectBundle(authorMismatch),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle_reference')
        return true
      },
    )

    const dup: ProjectBundleV2 = {
      ...base,
      deliveries: [base.deliveries[0]!, { ...base.deliveries[0]! }],
    }
    assert.throws(
      () => parseProjectBundle(dup),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'duplicate_delivery_id')
        return true
      },
    )
  })

  it('roundtrip v2 remapeia referências, recibos e resoluções sem misturar seus estados', () => {
    const dir = createTempDir('axon-bundle-v2-')
    const store = new WorkspaceStore(join(dir, 'workspace.sqlite'), {
      now: () => new Date('2026-09-14T12:00:00.000Z'),
    })
    cleanups.push(() => store.close())

    const project = store.createProject({
      name: 'Portátil v2',
      objective: 'Levar backlog e passagem',
    })
    const task = store.createTask(project.id, { title: 'Tarefa de origem' })
    store.claimTask(project.id, task.id, { agent: 'Astra', expectedVersion: 0 })
    const checkpoint = store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'v2-cp',
      taskId: task.id,
      agent: 'Astra',
      summary: 'Checkpoint de origem',
      nextStep: 'Continuar no destino',
    })
    const delivery = store.createHandoffDelivery(project.id, {
      checkpointId: checkpoint.id,
      from: 'Astra',
      to: 'Grok',
      message: 'Leia o checkpoint antes de assumir.',
    })
    const receipt = store.acknowledgeHandoffDelivery(project.id, delivery.id, { agent: 'Grok' })
    const question = store.postMessage(project.id, {
      from: 'Astra',
      to: 'Grok',
      kind: 'question',
      body: 'A tarefa pode seguir?',
    })
    const response = store.postMessage(project.id, {
      from: 'Grok',
      to: 'Astra',
      kind: 'note',
      body: 'Pode seguir conforme o checkpoint.',
    })
    const resolution = store.resolveMessageAttention(project.id, question.id, {
      agent: 'Grok',
      responseMessageId: response.id,
    })
    const idea = store.createBacklogItem(project.id, {
      title: 'Ideia solta',
      createdBy: 'Astra',
      priority: 'low',
    })
    const ready = store.createBacklogItem(project.id, {
      title: 'Pronto para promover',
      createdBy: 'Astra',
      stage: 'ready',
    })
    const promoted = store.promoteBacklogItem(project.id, ready.id)

    const data = store.exportProjectBundleData(project.id)
    const bundle = createProjectBundleV2(data)
    assert.equal(bundle.version, 2)
    assert.equal(bundle.backlogItems.length, 2)
    assert.equal(bundle.deliveries.length, 1)
    assert.equal(bundle.deliveryReceipts.length, 1)
    assert.equal(bundle.deliveryReceipts[0]?.acknowledgedAt, receipt.acknowledgedAt)
    assert.equal(bundle.messageResolutions?.length, 1)
    assert.equal(bundle.messageResolutions?.[0]?.resolvedAt, resolution.resolvedAt)

    const imported = store.importProjectBundleData(bundle)
    assert.notEqual(imported.project.id, project.id)
    assert.ok(imported.idMap[task.id])
    assert.ok(imported.idMap[checkpoint.id])
    assert.ok(imported.idMap[delivery.id])
    assert.ok(imported.idMap[idea.id])
    assert.ok(imported.idMap[promoted.item.id])
    assert.ok(imported.idMap[promoted.task.id])
    assert.ok(imported.idMap[question.id])
    assert.ok(imported.idMap[response.id])

    const copy = store.getProject(imported.project.id)
    assert.equal(copy.tasks.every((entry) => entry.status === 'todo' && entry.assignee === null), true)
    const copyBacklog = store.listBacklog(imported.project.id, { includeClosed: true })
    const copyPromoted = copyBacklog.find((entry) => entry.stage === 'promoted')
    assert.ok(copyPromoted)
    assert.equal(copyPromoted?.promotedTaskId, imported.idMap[promoted.task.id])
    assert.notEqual(copyPromoted?.promotedTaskId, promoted.task.id)
    const copyCp = copy.checkpoints[0]
    assert.equal(copyCp?.taskId, imported.idMap[task.id])

    const copyDeliveries = store.getHandoffDeliveries(imported.project.id, 'Grok')
    assert.equal(copyDeliveries.length, 1)
    assert.equal(copyDeliveries[0]?.id, imported.idMap[delivery.id])
    assert.equal(copyDeliveries[0]?.checkpointId, imported.idMap[checkpoint.id])
    assert.equal(copyDeliveries[0]?.taskId, imported.idMap[task.id])
    assert.equal(copyDeliveries[0]?.message, 'Leia o checkpoint antes de assumir.')
    assert.ok(copyDeliveries[0]?.acknowledgedAt)

    const importedQuestion = store
      .getInbox(imported.project.id, 'Grok')
      .find((item) => item.message.id === imported.idMap[question.id])
    assert.ok(importedQuestion?.resolution)
    assert.equal(importedQuestion?.acknowledgedAt, null)
    assert.equal(importedQuestion?.resolution?.projectId, imported.project.id)
    assert.equal(importedQuestion?.resolution?.messageId, imported.idMap[question.id])
    assert.equal(importedQuestion?.resolution?.responseMessageId, imported.idMap[response.id])
    assert.equal(importedQuestion?.resolution?.resolvedAt, resolution.resolvedAt)

    const v1 = createProjectBundle(store.exportProject(project.id))
    const importedV1 = store.importProjectBundleData(v1)
    assert.notEqual(importedV1.project.id, project.id)
    assert.equal(store.listBacklog(importedV1.project.id, { includeClosed: true }).length, 0)
    assert.equal(store.getHandoffDeliveries(importedV1.project.id, 'Grok').length, 0)
    const importedV1Inbox = store.getInbox(importedV1.project.id, 'Grok')
    assert.equal(importedV1Inbox.length, 1)
    assert.equal(importedV1Inbox.every((item) => item.resolution === null), true)
  })

  it('rejeita v2 inválido atomicamente sem deixar projeto parcial', () => {
    const dir = createTempDir('axon-bundle-v2-atomic-')
    const store = new WorkspaceStore(join(dir, 'workspace.sqlite'))
    cleanups.push(() => store.close())
    const before = store.listProjects().length
    const detail = makeValidDetail()
    const deliveryId = randomUUID()
    const invalid = createProjectBundleV2({
      project: detail,
      backlogItems: [],
      deliveries: [
        {
          id: deliveryId,
          projectId: detail.project.id,
          checkpointId: detail.checkpoints[0]!.id,
          taskId: detail.tasks[0]!.id,
          from: 'Gemini',
          to: 'Grok',
          message: 'válida',
          createdAt: detail.project.createdAt,
        },
      ],
      deliveryReceipts: [],
    })
    const forged = {
      ...invalid,
      deliveryReceipts: [
        {
          projectId: detail.project.id,
          deliveryId: randomUUID(),
          agent: 'Grok',
          acknowledgedAt: detail.project.updatedAt,
        },
      ],
    }

    assert.throws(
      () => store.importProjectBundleData(forged),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        return true
      },
    )
    assert.equal(store.listProjects().length, before)
  })

  it('rejeita conclusão v2 adulterada antes de criar qualquer projeto', () => {
    const dir = createTempDir('axon-bundle-v2-done-atomic-')
    const store = new WorkspaceStore(join(dir, 'workspace.sqlite'))
    cleanups.push(() => store.close())
    const before = store.listProjects().length
    const detail = makeValidDetail()
    detail.tasks[0] = {
      ...detail.tasks[0]!,
      status: 'done',
      assignee: null,
      completionCheckpointId: detail.checkpoints[0]!.id,
    }
    const valid = createProjectBundleV2({
      project: detail,
      backlogItems: [],
      deliveries: [],
      deliveryReceipts: [],
      messageResolutions: [],
    })
    const forged: ProjectBundleV2 = {
      ...valid,
      project: {
        ...valid.project,
        tasks: [
          {
            ...valid.project.tasks[0]!,
            completionCheckpointId: randomUUID(),
          },
        ],
      },
    }

    assert.throws(
      () => store.importProjectBundleData(forged),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle_reference')
        return true
      },
    )
    assert.equal(store.listProjects().length, before)
  })
})

describe('ProjectBundle v3: contratos de tarefas, biblioteca, decisões, bloqueios e integridade relacional', () => {
  it('exporta v3 com contratos de tarefas, charter, decisões, bloqueios, biblioteca e rascunhos sanitizados', () => {
    const dir = createTempDir('axon-bundle-v3-export-')
    const store = new WorkspaceStore(join(dir, 'workspace.sqlite'))
    cleanups.push(() => store.close())

    const project = store.createProject({
      name: 'Projeto V3 Teste',
      objective: 'Validar exportação V3 com API_KEY=xyz_secret',
      workspacePath: dir,
    })
    const pid = project.id

    const task1 = store.createTask(pid, {
      title: 'Tarefa 1 Contrato',
      description: 'Descricao com PASSWORD=secret123',
      priority: 'urgent',
      acceptanceCriteria: [
        { description: 'Criterio com API_KEY=token_secret_456', completed: false },
      ],
      expectedOutputs: [
        {
          title: 'Output 1 com API_KEY=sk_999',
          kind: 'file_path',
          locator: 'src/config/PASSWORD=abc.json',
        },
      ],
    })

    const task2 = store.createTask(pid, {
      title: 'Tarefa 2 Dependente',
      description: 'Depende da tarefa 1',
      priority: 'high',
      dependencyTaskIds: [task1.id],
    })

    store.saveCharter(pid, {
      actor: 'Astra',
      expectedRevision: 1,
      body: 'Charter revisado com API_KEY=privkey_789',
    })

    const d1 = store.proposeDecision(pid, {
      agent: 'Astra',
      title: 'Decisao 1 com API_KEY=tok1',
      body: 'Corpo da decisao 1 com PASSWORD=d1pass',
      note: 'Nota com API_KEY=key1',
    })
    store.acceptDecision(pid, d1.id, { actor: 'Operator', expectedVersion: 0 })

    store.supersedeDecision(pid, d1.id, {
      actor: 'Grok',
      title: 'Decisao 2 substituta',
      body: 'Corpo da decisao 2 com API_KEY=tok2',
      note: 'Nota com PASSWORD=sec2',
      expectedVersion: 1,
    })

    const blocker = store.openBlocker(pid, {
      agent: 'Astra',
      taskId: task1.id,
      title: 'Bloqueio na tarefa 1 com PASSWORD=blockerpass',
      body: 'Detalhes do bloqueio com API_KEY=blockerkey',
    })

    const content = store.createContent(pid, {
      title: 'Artigo Guia com API_KEY=guide_tok',
      kind: 'specification',
      format: 'markdown',
      body: 'Corpo do guia versao 1 com PASSWORD=v1pass',
      createdBy: 'Astra',
      sourceKind: 'agent_report',
    })
    const rev2 = store.reviseContent(pid, content.item.id, {
      expectedVersion: 0,
      createdBy: 'Grok',
      sourceKind: 'agent_report',
      format: 'markdown',
      body: 'Corpo do guia versao 2 atualizado com API_KEY=v2key e termo busca_fts_especial',
    })

    store.addContentRelation(pid, {
      sourceRevisionId: rev2.revision.id,
      targetType: 'task',
      targetId: task1.id,
      kind: 'supports',
      createdBy: 'Astra',
    })
    store.addContentRelation(pid, {
      sourceRevisionId: rev2.revision.id,
      targetType: 'decision',
      targetId: d1.id,
      kind: 'related',
      createdBy: 'Astra',
    })
    store.addContentRelation(pid, {
      sourceRevisionId: rev2.revision.id,
      targetType: 'blocker',
      targetId: blocker.id,
      kind: 'contradicts',
      createdBy: 'Astra',
    })

    store.saveWorkDraft(pid, {
      agent: 'Astra',
      taskId: task1.id,
      expectedVersion: 0,
      summary: 'Rascunho de trabalho com PASSWORD=draftpass',
      nextAction: 'Proxima acao com API_KEY=draftkey',
      changedAreas: ['src/core com API_KEY=drafttok'],
      openIssues: ['Questao com PASSWORD=draftsec'],
      observedChecks: [
        { commandOrMethod: 'npm test', reportedOutcome: 'pass com API_KEY=checktok' },
      ],
    })

    const exportedData = store.exportProjectBundleData(pid)
    const bundle = createProjectBundleV3(exportedData)

    assert.equal(bundle.format, 'axon-project')
    assert.equal(bundle.version, 3)

    const serialized = JSON.stringify(bundle)
    assert.equal(serialized.includes('xyz_secret'), false)
    assert.equal(serialized.includes('secret123'), false)
    assert.equal(serialized.includes('token_secret_456'), false)
    assert.equal(serialized.includes('sk_999'), false)
    assert.equal(serialized.includes('privkey_789'), false)
    assert.equal(serialized.includes('d1pass'), false)
    assert.equal(serialized.includes('blockerpass'), false)
    assert.equal(serialized.includes('v1pass'), false)
    assert.equal(serialized.includes('v2key'), false)
    assert.equal(serialized.includes('draftpass'), false)

    assert.equal(bundle.project.tasks.length, 2)
    const bTask1 = bundle.project.tasks.find((t) => t.title === 'Tarefa 1 Contrato')!
    assert.equal(bTask1.priority, 'urgent')
    assert.ok(bTask1.description?.includes('PASSWORD=***'))
    assert.equal(bTask1.acceptanceCriteria?.length, 1)
    assert.ok(bTask1.acceptanceCriteria?.[0]?.description.includes('API_KEY=***'))
    assert.equal(bTask1.expectedOutputs?.length, 1)
    assert.ok(bTask1.expectedOutputs?.[0]?.title.includes('API_KEY=***'))

    const bTask2 = bundle.project.tasks.find((t) => t.title === 'Tarefa 2 Dependente')!
    assert.deepEqual(bTask2.dependencyTaskIds, [bTask1.id])

    assert.equal(bundle.charterRevisions.length, 2)
    assert.ok(bundle.charterRevisions[1]?.body.includes('API_KEY=***'))

    assert.equal(bundle.decisions.length, 2)

    assert.equal(bundle.blockers.length, 1)
    assert.equal(bundle.blockers[0]?.taskId, bTask1.id)

    assert.equal(bundle.library.items.length, 1)
    assert.equal(bundle.library.revisions.length, 2)
    assert.equal(bundle.library.relations.length, 3)

    assert.equal(bundle.workDrafts?.length, 1)
    assert.ok(bundle.workDrafts?.[0]?.summary.includes('PASSWORD=***'))

    const parsed = parseProjectBundle(bundle)
    assert.equal(parsed.version, 3)
  })

  it('roundtrip v3 completo remapeia todas as entidades biunivocamente mantendo integridade e sincroniza FTS5', () => {
    const dir1 = createTempDir('axon-bundle-v3-roundtrip-src-')
    const store1 = new WorkspaceStore(join(dir1, 'workspace1.sqlite'))
    cleanups.push(() => store1.close())

    const project = store1.createProject({
      name: 'Projeto Original V3',
      objective: 'Objetivo de teste para roundtrip',
      workspacePath: dir1,
    })
    const pid = project.id

    const task1 = store1.createTask(pid, {
      title: 'Tarefa A',
      description: 'Descricao A',
      priority: 'high',
      acceptanceCriteria: [{ description: 'Criterio A1', completed: true }],
      expectedOutputs: [{ title: 'Output A1', kind: 'file_path', locator: 'src/index.ts' }],
    })
    const task2 = store1.createTask(pid, {
      title: 'Tarefa B',
      description: 'Descricao B',
      priority: 'low',
      dependencyTaskIds: [task1.id],
    })

    store1.saveCharter(pid, { actor: 'Astra', expectedRevision: 1, body: 'Charter Segunda Revisao' })

    const d1 = store1.proposeDecision(pid, {
      agent: 'Astra',
      title: 'Decisao Inicial',
      body: 'Corpo da decisao inicial',
    })
    store1.acceptDecision(pid, d1.id, { actor: 'Operator', expectedVersion: 0 })
    const d2 = store1.supersedeDecision(pid, d1.id, {
      actor: 'Grok',
      title: 'Decisao Vigente',
      body: 'Substitui a decisao inicial',
      expectedVersion: 1,
    })

    const blocker = store1.openBlocker(pid, {
      agent: 'Astra',
      taskId: task1.id,
      title: 'Bloqueio Impeditivo',
      body: 'Aguardando recurso externo',
    })

    const content = store1.createContent(pid, {
      title: 'Documento de Arquitetura',
      kind: 'specification',
      format: 'markdown',
      body: 'Especificacao com termo_unico_busca_fts_123',
      createdBy: 'Astra',
      sourceKind: 'agent_report',
    })
    store1.addContentRelation(pid, {
      sourceRevisionId: content.revision.id,
      targetType: 'task',
      targetId: task1.id,
      kind: 'supports',
      createdBy: 'Astra',
    })
    store1.addContentRelation(pid, {
      sourceRevisionId: content.revision.id,
      targetType: 'decision',
      targetId: d2.id,
      kind: 'related',
      createdBy: 'Astra',
    })
    store1.addContentRelation(pid, {
      sourceRevisionId: content.revision.id,
      targetType: 'blocker',
      targetId: blocker.id,
      kind: 'contradicts',
      createdBy: 'Astra',
    })

    store1.saveWorkDraft(pid, {
      agent: 'Astra',
      taskId: task1.id,
      expectedVersion: 0,
      summary: 'Resumo do rascunho de trabalho',
      nextAction: 'Continuar implementacao',
    })

    const bundleData = store1.exportProjectBundleData(pid)
    const bundle = createProjectBundleV3(bundleData)

    const dir2 = createTempDir('axon-bundle-v3-roundtrip-dst-')
    const store2 = new WorkspaceStore(join(dir2, 'workspace2.sqlite'))
    cleanups.push(() => store2.close())

    const importResult = store2.importProjectBundleData(bundle)
    const newPid = importResult.project.id
    assert.notEqual(newPid, pid)
    assert.equal(importResult.project.name, project.name)

    const importedDetail = store2.getProject(newPid)
    assert.equal(importedDetail.tasks.length, 2)
    const impTask1 = importedDetail.tasks.find((t) => t.title === 'Tarefa A')!
    const impTask2 = importedDetail.tasks.find((t) => t.title === 'Tarefa B')!
    assert.notEqual(impTask1.id, task1.id)
    assert.notEqual(impTask2.id, task2.id)
    assert.equal(impTask1.priority, 'high')
    assert.equal(impTask1.acceptanceCriteria?.length, 1)
    assert.equal(impTask1.acceptanceCriteria?.[0]?.description, 'Criterio A1')
    assert.equal(impTask1.expectedOutputs?.length, 1)
    assert.equal(impTask1.expectedOutputs?.[0]?.title, 'Output A1')

    assert.deepEqual(impTask2.dependencyTaskIds, [impTask1.id])

    const charter = store2.getCharter(newPid)
    assert.ok(charter)
    assert.equal(charter.revision, 2)
    assert.equal(charter.body, 'Charter Segunda Revisao')

    const decisions = store2.listDecisions(newPid, { includeHistory: true })
    assert.equal(decisions.length, 2)
    const impD1 = decisions.find((d) => d.title === 'Decisao Inicial')!
    const impD2 = decisions.find((d) => d.title === 'Decisao Vigente')!
    assert.notEqual(impD1.id, d1.id)
    assert.notEqual(impD2.id, d2.id)
    assert.equal(impD2.supersedesId, impD1.id)
    assert.equal(impD1.supersededById, impD2.id)

    const blockers = store2.listBlockers(newPid, { includeClosed: true })
    assert.equal(blockers.length, 1)
    assert.equal(blockers[0]?.taskId, impTask1.id)

    const libraryItems = store2.listContent(newPid, {})
    assert.equal(libraryItems.length, 1)
    const impEntry = libraryItems[0]!
    assert.notEqual(impEntry.item.id, content.item.id)

    const relations = store2.getContent(newPid, impEntry.item.id).relations
    assert.equal(relations.length, 3)
    const taskRel = relations.find((r) => r.targetType === 'task')!
    const decisionRel = relations.find((r) => r.targetType === 'decision')!
    const blockerRel = relations.find((r) => r.targetType === 'blocker')!
    assert.equal(taskRel.targetId, impTask1.id)
    assert.equal(decisionRel.targetId, impD2.id)
    assert.equal(blockerRel.targetId, blockers[0]!.id)

    const searchMatches = store2.searchContent(newPid, 'termo_unico_busca_fts_123')
    assert.equal(searchMatches.length, 1)
    assert.equal(searchMatches[0]?.item.id, impEntry.item.id)

    const draft = store2.getWorkDraft(newPid, 'Astra', impTask1.id)
    assert.ok(draft)
    assert.equal(draft.taskId, impTask1.id)
    assert.equal(draft.summary, 'Resumo do rascunho de trabalho')
  })

  it('rejeita dependência cíclica entre tarefas no v3', () => {
    const detail = makeValidDetail()
    const taskAId = randomUUID()
    const taskBId = randomUUID()
    detail.checkpoints[0]!.taskId = taskAId
    detail.tasks = [
      {
        id: taskAId,
        projectId: detail.project.id,
        title: 'Tarefa A',
        status: 'todo',
        assignee: null,
        leaseUntil: null,
        version: 0,
        blockedReason: null,
        completionCheckpointId: null,
        workIntent: null,
        createdAt: detail.project.createdAt,
        dependencyTaskIds: [taskBId],
      },
      {
        id: taskBId,
        projectId: detail.project.id,
        title: 'Tarefa B',
        status: 'todo',
        assignee: null,
        leaseUntil: null,
        version: 0,
        blockedReason: null,
        completionCheckpointId: null,
        workIntent: null,
        createdAt: detail.project.createdAt,
        dependencyTaskIds: [taskAId],
      },
    ]

    assert.throws(
      () =>
        createProjectBundleV3({
          project: detail,
          backlogItems: [],
          deliveries: [],
          deliveryReceipts: [],
          messageResolutions: [],
        }),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'cyclic_task_dependency')
        return true
      },
    )

    detail.tasks[0]!.dependencyTaskIds = [taskAId]
    detail.tasks[1]!.dependencyTaskIds = []
    assert.throws(
      () =>
        createProjectBundleV3({
          project: detail,
          backlogItems: [],
          deliveries: [],
          deliveryReceipts: [],
          messageResolutions: [],
        }),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'cyclic_task_dependency')
        return true
      },
    )
  })

  it('rejeita substituição cíclica entre decisões no v3', () => {
    const detail = makeValidDetail()
    const d1Id = randomUUID()
    const d2Id = randomUUID()
    const decisions = [
      {
        id: d1Id,
        projectId: detail.project.id,
        title: 'D1',
        body: 'Corpo D1',
        status: 'revoked' as const,
        proposedBy: 'Astra',
        acceptedBy: 'Operator',
        revokedBy: 'Grok',
        supersedesId: d2Id,
        supersededById: d2Id,
        version: 1,
        createdAt: detail.project.createdAt,
        updatedAt: detail.project.updatedAt,
        source: { kind: 'agent_proposal' as const },
      },
      {
        id: d2Id,
        projectId: detail.project.id,
        title: 'D2',
        body: 'Corpo D2',
        status: 'accepted' as const,
        proposedBy: 'Grok',
        acceptedBy: 'Operator',
        revokedBy: null,
        supersedesId: d1Id,
        supersededById: null,
        version: 1,
        createdAt: detail.project.createdAt,
        updatedAt: detail.project.updatedAt,
        source: { kind: 'agent_proposal' as const },
      },
    ]

    assert.throws(
      () =>
        createProjectBundleV3({
          project: detail,
          backlogItems: [],
          deliveries: [],
          deliveryReceipts: [],
          messageResolutions: [],
          decisions,
        }),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'cyclic_decision_supersession')
        return true
      },
    )
  })

  it('rejeita relações de biblioteca apontando para alvos inexistentes', () => {
    const detail = makeValidDetail()
    const itemId = randomUUID()
    const revId = randomUUID()
    const bundleV3: ProjectBundleV3 = {
      format: 'axon-project',
      version: 3,
      exportedAt: new Date().toISOString(),
      project: detail,
      backlogItems: [],
      deliveries: [],
      deliveryReceipts: [],
      messageResolutions: [],
      charterRevisions: [],
      decisions: [],
      blockers: [],
      library: {
        items: [
          {
            id: itemId,
            projectId: detail.project.id,
            title: 'Item 1',
            kind: 'note',
            status: 'active',
            currentRevisionId: revId,
            version: 0,
            createdAt: detail.project.createdAt,
            updatedAt: detail.project.updatedAt,
          },
        ],
        revisions: [
          {
            id: revId,
            itemId,
            revision: 1,
            body: 'Corpo',
            format: 'markdown',
            createdBy: 'Astra',
            createdAt: detail.project.createdAt,
            supersedesId: null,
            sourceKind: 'agent_report',
            declaredValidity: 'current',
          },
        ],
        relations: [
          {
            id: randomUUID(),
            projectId: detail.project.id,
            sourceRevisionId: revId,
            targetType: 'task',
            targetId: randomUUID(),
            kind: 'supports',
            createdBy: 'Astra',
            createdAt: detail.project.createdAt,
          },
        ],
      },
    }

    assert.throws(
      () => parseProjectBundle(bundleV3),
      (err: unknown) => {
        assert.ok(err instanceof PortabilityError)
        assert.equal(err.status, 400)
        assert.equal(err.code, 'invalid_bundle_reference')
        return true
      },
    )
  })

  it('preserva retrocompatibilidade total importando perfeitamente pacotes v1 e v2', () => {
    const dir = createTempDir('axon-bundle-compat-')
    const store = new WorkspaceStore(join(dir, 'workspace.sqlite'))
    cleanups.push(() => store.close())

    const v1Detail = makeValidDetail()
    const v1Bundle = createProjectBundle(v1Detail)
    const v1Result = store.importProjectBundleData(v1Bundle)
    assert.ok(v1Result.project.id)
    const v1Charter = store.getCharter(v1Result.project.id)
    assert.ok(v1Charter)
    assert.equal(v1Charter.revision, 1)

    const v2Detail = makeValidDetail()
    const v2Bundle = createProjectBundleV2({
      project: v2Detail,
      backlogItems: [
        {
          id: randomUUID(),
          projectId: v2Detail.project.id,
          title: 'Item de Backlog v2',
          description: 'Descricao backlog',
          priority: 'medium',
          stage: 'idea',
          createdBy: 'Astra',
          promotedTaskId: null,
          version: 0,
          createdAt: v2Detail.project.createdAt,
          updatedAt: v2Detail.project.updatedAt,
        },
      ],
      deliveries: [],
      deliveryReceipts: [],
      messageResolutions: [],
    })
    const v2Result = store.importProjectBundleData(v2Bundle)
    assert.ok(v2Result.project.id)
    const v2Backlog = store.listBacklog(v2Result.project.id)
    assert.equal(v2Backlog.length, 1)
    assert.equal(v2Backlog[0]?.title, 'Item de Backlog v2')
    const v2Charter = store.getCharter(v2Result.project.id)
    assert.ok(v2Charter)
    assert.equal(v2Charter.revision, 1)
  })
})
