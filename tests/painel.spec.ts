import { test, expect, type APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

/**
 * Partes 7 e 5 (tela) — Resumo ao acordar e Esperando por você.
 *
 * Sem page.route: todo dado nasce de verdade pela API (fixture `request`) e o
 * servidor real responde. Para a tarefa parada (cenário 6), a técnica do
 * briefing: reservar de verdade e mover só `lease_until` no banco da suíte
 * (`process.env.AXON_E2E_DB_PATH`), já provada em tests/copiar-e-selos.spec.ts.
 */

const HEADERS = { 'X-Workspace-Client': 'local' };

async function criarProjeto(request: APIRequestContext, name: string, objective = 'Objetivo inicial do projeto.') {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name, objective } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function criarTarefa(request: APIRequestContext, projectId: string, title: string) {
  const res = await request.post(`/api/projects/${projectId}/tasks`, { headers: HEADERS, data: { title } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function concluirTarefa(request: APIRequestContext, projectId: string, taskId: string, opts: { agent: string; summary: string; humanSummary?: string; idempotencyKey: string; evidence?: Array<{ command: string; outcome: string; details: string }> }) {
  // finalizeWork exige concessão ativa do próprio agente sobre a tarefa.
  const claimRes = await request.post(`/api/projects/${projectId}/tasks/${taskId}/claim`, {
    headers: HEADERS,
    data: { agent: opts.agent, expectedVersion: 0 },
  });
  expect(claimRes.ok()).toBeTruthy();
  const res = await request.post(`/api/projects/${projectId}/finalize`, {
    headers: HEADERS,
    data: {
      agent: opts.agent,
      expectedRevision: 0,
      idempotencyKey: opts.idempotencyKey,
      summary: opts.summary,
      ...(opts.humanSummary ? { humanSummary: opts.humanSummary } : {}),
      nextStep: 'Seguir para a próxima etapa.',
      taskId,
      taskTransition: { kind: 'declare_done' },
      ...(opts.evidence ? { evidence: opts.evidence } : {}),
    },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function proporAprovacao(request: APIRequestContext, projectId: string, input: { agent: string; kind: 'charter_change' | 'note'; title: string; body: string; rationale: string }) {
  const res = await request.post(`/api/projects/${projectId}/approvals`, { headers: HEADERS, data: input });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

test('tarefa concluída com frase simples aparece em "Ficou pronto" com a frase, não o jargão', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Frase Simples');
  const task = await criarTarefa(request, project.id, 'Preparar exportação de dados');
  await concluirTarefa(request, project.id, task.id, {
    agent: 'Astra',
    summary: 'finalizeWork gravou checkpoint e fechou a tarefa via taskTransition declare_done',
    humanSummary: 'A exportação de dados já funciona de ponta a ponta.',
    idempotencyKey: 'painel-frase-simples-1',
    evidence: [{ command: 'npm test', outcome: 'passed', details: '42/42 verdes' }],
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const item = page.locator('.resumo-item-pronto').filter({ hasText: 'Preparar exportação de dados' });
  await expect(item).toBeVisible();
  await expect(item).toContainText('A exportação de dados já funciona de ponta a ponta.');
  await expect(item).not.toContainText('Resumo técnico');
  await expect(item).not.toContainText('finalizeWork gravou checkpoint');
  await expect(item.locator('.resumo-confianca')).toContainText('Informado pela IA');
});

test('tarefa concluída SEM frase simples mostra o resumo técnico rotulado como tal, sem fingir que é para humanos', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Sem Frase Simples');
  const task = await criarTarefa(request, project.id, 'Migrar schema do banco');
  await concluirTarefa(request, project.id, task.id, {
    agent: 'Grok',
    summary: 'ALTER TABLE tasks ADD COLUMN lease_notes TEXT executado com sucesso',
    idempotencyKey: 'painel-sem-frase-1',
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const item = page.locator('.resumo-item-pronto').filter({ hasText: 'Migrar schema do banco' });
  await expect(item).toBeVisible();
  await expect(item).toContainText('Resumo técnico');
  await expect(item).toContainText('ALTER TABLE tasks ADD COLUMN lease_notes TEXT executado com sucesso');
  await expect(item.locator('.resumo-confianca')).toContainText('Sem evidência registrada');
});

test('período sem novidade: nenhuma tarefa concluída mostra linha calma, sem seções fabricadas', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Recém Criado');

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  await expect(page.locator('.resumo-vazio')).toContainText('Nenhuma tarefa concluída');
  await expect(page.locator('.resumo-vazio')).toContainText('últimas 24 horas');
  await expect(page.locator('.resumo-momentum')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Esperando por você' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Travado' })).toHaveCount(0);
  await expect(page.locator('#fila-de-aprovacoes')).toHaveCount(0);
});

test('proposta de mudança de diretriz aprovada pela tela muda a diretriz de verdade', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Diretriz', 'Diretriz original: manter o escopo pequeno.');
  await proporAprovacao(request, project.id, {
    agent: 'Grok',
    kind: 'charter_change',
    title: 'Ampliar o escopo do projeto',
    body: 'Diretriz nova: priorizar integrações externas antes do lançamento.',
    rationale: 'O parceiro pediu integração antes do prazo original.',
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  await expect(page.getByText('1 proposta espera sua decisão')).toBeVisible();
  await page.getByRole('button', { name: 'Ver propostas' }).click();

  const fila = page.locator('#fila-de-aprovacoes');
  await expect(fila).toBeVisible();
  const card = fila.locator('.fila-card').filter({ hasText: 'Ampliar o escopo do projeto' });
  await expect(card).toContainText('Proposto por Grok');
  await expect(card).toContainText('O parceiro pediu integração antes do prazo original.');
  await expect(card).toContainText('Diretriz original: manter o escopo pequeno.');
  await expect(card).toContainText('Diretriz nova: priorizar integrações externas antes do lançamento.');

  await fila.getByLabel('Seu nome, para registrar decisões').fill('Dono do projeto');
  await fila.getByRole('button', { name: 'Salvar nome' }).click();

  await card.getByRole('button', { name: 'Aprovar diretriz', exact: true }).click();
  await expect(card).toContainText('A nova diretriz passa a valer para todas as IAs.');
  await card.getByRole('button', { name: 'Aprovar diretriz', exact: true }).click();

  await expect(page.getByText('Diretriz aprovada')).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.locator('#fila-de-aprovacoes')).toHaveCount(0);

  const charterRes = await request.get(`/api/projects/${project.id}/charter`);
  const charter = await charterRes.json();
  expect(charter.body).toBe('Diretriz nova: priorizar integrações externas antes do lançamento.');
  expect(charter.createdBy).toBe('Dono do projeto');

  const projectRes = await request.get(`/api/projects/${project.id}`);
  const detail = await projectRes.json();
  expect(detail.project.objective).toBe('Diretriz nova: priorizar integrações externas antes do lançamento.');
});

test('proposta recusada exige motivo e o motivo fica registrado', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Nota Recusada');
  await proporAprovacao(request, project.id, {
    agent: 'Gemini',
    kind: 'note',
    title: 'Registrar decisão de nomenclatura',
    body: 'Passar a chamar o módulo de "núcleo" em vez de "core".',
    rationale: 'Reduz jargão em inglês na documentação.',
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const fila = page.locator('#fila-de-aprovacoes');
  const card = fila.locator('.fila-card').filter({ hasText: 'Registrar decisão de nomenclatura' });
  await expect(card).toBeVisible();

  await fila.getByLabel('Seu nome, para registrar decisões').fill('Responsável pelo projeto');
  await fila.getByRole('button', { name: 'Salvar nome' }).click();

  await card.getByRole('button', { name: 'Recusar proposta', exact: true }).click();
  const motivo = card.getByLabel('Motivo da recusa');
  await expect(motivo).toBeVisible();
  const confirmar = card.getByRole('button', { name: 'Recusar proposta', exact: true });
  await expect(confirmar).toBeDisabled();
  await motivo.fill('Já existe convenção estabelecida usando "core".');
  await expect(confirmar).toBeEnabled();
  await confirmar.click();

  await expect(page.getByText('Proposta recusada')).toBeVisible();
  await expect(card).toHaveCount(0);

  const listRes = await request.get(`/api/projects/${project.id}/approvals?status=rejected`);
  const rejected = await listRes.json();
  expect(rejected).toHaveLength(1);
  expect(rejected[0].decisionNote).toBe('Já existe convenção estabelecida usando "core".');
  expect(rejected[0].decidedBy).toBe('Responsável pelo projeto');
});

test('tarefa realmente parada aparece em "Travado" com o motivo, sem esperar o tempo real', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Travado');
  const task = await criarTarefa(request, project.id, 'Tarefa sem notícia da IA');
  const claimRes = await request.post(`/api/projects/${project.id}/tasks/${task.id}/claim`, {
    headers: HEADERS,
    data: { agent: 'Grok', expectedVersion: task.version },
  });
  expect(claimRes.ok()).toBeTruthy();

  const dbPath = process.env.AXON_E2E_DB_PATH;
  expect(dbPath, 'AXON_E2E_DB_PATH deve estar definido').toBeTruthy();
  const db = new DatabaseSync(dbPath!);
  const horasAtras = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  db.prepare('UPDATE tasks SET lease_until = ? WHERE id = ?').run(horasAtras, task.id);
  db.close();

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const travado = page.getByRole('region', { name: 'Travado' });
  await expect(travado).toBeVisible();
  await expect(travado).toContainText('Tarefa sem notícia da IA');
  await expect(travado).toContainText('A reserva de Grok');
  await expect(travado).toContainText('não existe nenhum checkpoint dessa identidade nesta tarefa');
});

test('abrir o projeto com proposta pendente não rola a página até o campo de nome', async ({ page, request }) => {
  // Defeito real: o campo de nome recebia foco automático ao carregar, e o
  // navegador rolava a página até ele. Na primeira visita — justamente a de
  // manhã — o dono perdia o topo do resumo sem ter tocado em nada.
  const project = await criarProjeto(request, 'Projeto sem pulo ' + Date.now());
  // concluirTarefa fixa expectedRevision 0 e serve para uma tarefa por projeto;
  // aqui sao seis, entao cada conclusao le a revisao atual antes de gravar.
  for (let i = 1; i <= 6; i++) {
    const tarefa = await criarTarefa(request, project.id, `Tarefa concluída ${i}`);
    const reserva = await request.post(`/api/projects/${project.id}/tasks/${tarefa.id}/claim`, { headers: HEADERS, data: { agent: 'Astra', expectedVersion: tarefa.version } });
    expect(reserva.ok()).toBeTruthy();
    const { project: atual } = await (await request.get(`/api/projects/${project.id}`)).json();
    const fim = await request.post(`/api/projects/${project.id}/finalize`, { headers: HEADERS, data: {
      agent: 'Astra', expectedRevision: atual.revision, idempotencyKey: `sem-pulo-${i}`, taskId: tarefa.id,
      summary: `Resumo técnico da tarefa ${i}, longo o bastante para ocupar espaço e empurrar a fila de aprovações para baixo da primeira tela.`,
      humanSummary: `A tarefa ${i} ficou pronta.`, nextStep: 'Seguir.', taskTransition: { kind: 'declare_done' },
    } });
    expect(fim.ok()).toBeTruthy();
  }
  await proporAprovacao(request, project.id, { agent: 'Grok', kind: 'note', title: 'Proposta pendente', body: 'Conteúdo da proposta.', rationale: 'Motivo da proposta.' });

  await page.goto(`/#project/${project.id}`);
  const campoNome = page.locator('#fila-nome-dono');
  await expect(campoNome).toBeAttached();

  // Sem isto o teste passaria mesmo com o defeito: o campo precisa estar abaixo da primeira tela.
  const posicaoNoDocumento = await campoNome.evaluate(el => el.getBoundingClientRect().top + window.scrollY);
  expect(posicaoNoDocumento).toBeGreaterThan(page.viewportSize()!.height);

  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('Parte 10: "Sugestões para agora" substitui "Próximo passo sugerido" no resumo', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Sugestões ' + Date.now());
  await criarTarefa(request, project.id, 'Tarefa pendente para gerar ação');

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const proximoAntigo = page.getByRole('region', { name: 'Próximo passo sugerido' });
  await expect(proximoAntigo).toHaveCount(0);
});

test('Parte 10: formulários de bloqueio e diretriz iniciam recolhidos e expandem ao clicar', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Formulários Recolhidos ' + Date.now());
  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  // Formulário de bloqueio começa recolhido atrás do botão "Abrir bloqueio"
  const botaoAbrirBloqueio = page.getByRole('button', { name: 'Abrir bloqueio', exact: true });
  await expect(botaoAbrirBloqueio).toBeVisible();
  await expect(page.getByLabel('Título do bloqueio')).toHaveCount(0);

  // Clica para expandir
  await botaoAbrirBloqueio.click();
  await expect(page.getByLabel('Título do bloqueio')).toBeVisible();
  await expect(page.getByLabel('O que impede o trabalho')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar bloqueio', exact: true })).toBeVisible();

  // Formulário de diretriz começa recolhido atrás do botão "Editar diretriz"
  const botaoEditarDiretriz = page.getByRole('button', { name: 'Editar diretriz', exact: true });
  await expect(botaoEditarDiretriz).toBeVisible();
  await expect(page.getByLabel('Texto vigente da diretriz do projeto')).toHaveCount(0);

  // Clica para expandir
  await botaoEditarDiretriz.click();
  await expect(page.getByLabel('Texto vigente da diretriz do projeto')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar versão', exact: true })).toBeVisible();
});

test('Parte 10: resumo técnico longo exibe primeiras linhas e "Ver mais" para expandir', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Resumo Longo ' + Date.now());
  const task = await criarTarefa(request, project.id, 'Tarefa com resumo técnico extenso');
  const resumoLongo = 'Executei a migração de 15 tabelas relacionais com verificação estrita de integridade referencial, recalculei índices parciais e realizei benchmark de performance com carga sintética de 1000 transações por segundo com latência p99 de 4ms.';
  await concluirTarefa(request, project.id, task.id, {
    agent: 'Grok',
    summary: resumoLongo,
    idempotencyKey: 'resumo-longo-1',
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const item = page.locator('.resumo-item-pronto').filter({ hasText: 'Tarefa com resumo técnico extenso' });
  await expect(item).toBeVisible();

  const toggle = item.getByRole('button', { name: 'Ver mais' });
  await expect(toggle).toBeVisible();

  // Ao clicar em "Ver mais", o texto completo se torna visível
  await toggle.click();
  await expect(item).toContainText(resumoLongo);
  await expect(item.getByRole('button', { name: 'Ver menos' })).toBeVisible();
});

test('Parte 10: aviso de nome de IA tem estilo neutro informativo e rodapé do próximo passo tem respiro', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Polimento Rodapé ' + Date.now());
  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  // Sem nome na barra lateral, aviso aparece em estilo neutro (.agent-warning-hint)
  const aviso = page.locator('.agent-warning-hint');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('Informe o nome na barra lateral');

  // Rodapé do cartão contém autor em bloco separado das ações
  const footer = page.locator('.resume-card-footer');
  await expect(footer).toBeVisible();
  await expect(footer.locator('.resume-card-actions')).toBeVisible();
  await expect(footer.locator('.resume-card-actions button')).toHaveCount(3);
});

test('Parte 10: estado "Tudo em dia" e marcador visual de progresso refletem dados reais', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Tudo em Dia ' + Date.now());
  const t1 = await criarTarefa(request, project.id, 'Primeira tarefa');
  await concluirTarefa(request, project.id, t1.id, {
    agent: 'Astra',
    summary: 'Conclusão da primeira tarefa com sucesso.',
    humanSummary: 'A primeira tarefa foi concluída com êxito.',
    idempotencyKey: 'tudo-em-dia-1',
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  // Marcador de progresso real do projeto: 1 de 1 concluídas (100%)
  const progresso = page.locator('.projeto-progresso-container');
  await expect(progresso).toBeVisible();
  await expect(progresso).toContainText('1 de 1 concluídas');
  await expect(progresso).toContainText('100%');

  // Estado "Tudo em dia" visível porque há atividade e nenhum bloqueio/proposta pendente
  const tudoEmDia = page.locator('.resumo-tudo-em-dia');
  await expect(tudoEmDia).toBeVisible();
  await expect(tudoEmDia).toContainText('Tudo em dia');
});

test('Parte 10: marcar critério pendente de verdade deixa marca de recompensa e persiste após recarga', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Recompensa Sucesso ' + Date.now());
  const task = await criarTarefa(request, project.id, 'Tarefa com critério para cumprir');
  await request.post(`/api/projects/${project.id}/tasks/${task.id}/contract`, {
    headers: HEADERS,
    data: {
      expectedVersion: task.version,
      acceptanceCriteria: [
        { description: 'Critério que será cumprido', completed: false },
      ],
    },
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const chip = page.locator('.task-criterion-chip').filter({ hasText: 'Critério que será cumprido' });
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveClass(/completed/);
  await expect(chip).not.toHaveAttribute('data-recompensa', 'criterio-cumprido');

  // Clica no critério para marcar como concluído
  await chip.click();

  // Recompensa honesta: o chip recebe a marcação de celebração após confirmação
  await expect(chip).toHaveAttribute('data-recompensa', 'criterio-cumprido');
  await expect(chip).toHaveClass(/completed/);

  // Recarrega a página e confirma que o critério persiste como concluído
  await page.reload();
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();
  const chipRecarregado = page.locator('.task-criterion-chip').filter({ hasText: 'Critério que será cumprido' });
  await expect(chipRecarregado).toBeVisible();
  await expect(chipRecarregado).toHaveClass(/completed/);
});

test('Parte 10: conflito ao salvar critério não comemora recompensa e exibe erro', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Recompensa Conflito ' + Date.now());
  const task = await criarTarefa(request, project.id, 'Tarefa com conflito de versão');
  await request.post(`/api/projects/${project.id}/tasks/${task.id}/contract`, {
    headers: HEADERS,
    data: {
      expectedVersion: task.version,
      acceptanceCriteria: [
        { description: 'Critério que deve falhar no salvamento', completed: false },
      ],
    },
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const chip = page.locator('.task-criterion-chip').filter({ hasText: 'Critério que deve falhar no salvamento' });
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveClass(/completed/);

  // Altera a versão da tarefa diretamente no backend para causar conflito de versão (expectedVersion divergente)
  const detailRes = await request.get(`/api/projects/${project.id}`);
  const detail = await detailRes.json();
  const tarefaNoBackend = detail.tasks.find((t: any) => t.id === task.id);
  expect(tarefaNoBackend).toBeDefined();

  const conflitoRes = await request.post(`/api/projects/${project.id}/tasks/${task.id}/contract`, {
    headers: HEADERS,
    data: {
      expectedVersion: tarefaNoBackend.version,
      title: 'Tarefa com conflito de versão alterada externamente',
      acceptanceCriteria: tarefaNoBackend.acceptanceCriteria,
    },
  });
  expect(conflitoRes.ok()).toBeTruthy();

  const alertaErro = page.locator('div[role="alert"]');
  await expect(alertaErro).toHaveCount(0);

  // Clica no chip na página (que ainda possui a versão anterior em memória)
  await chip.click();

  // Primeiro o erro aparece: prova de que o servidor já respondeu com o conflito.
  await expect(alertaErro).toBeVisible();

  // Só então a ausência de comemoração significa algo: nem antes, nem depois da resposta.
  await expect(chip).not.toHaveAttribute('data-recompensa', 'criterio-cumprido');
});

test('Parte 13: tarefa concluída ao vivo ganha comemoração ao atualizar projeto', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Comemoração Ao Vivo ' + Date.now());
  const task = await criarTarefa(request, project.id, 'Tarefa que será concluída ao vivo');

  const claimRes = await request.post(`/api/projects/${project.id}/tasks/${task.id}/claim`, {
    headers: HEADERS,
    data: { agent: 'Astra', expectedVersion: task.version },
  });
  expect(claimRes.ok()).toBeTruthy();

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const card = page.locator('.task').filter({ hasText: 'Tarefa que será concluída ao vivo' });
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('data-comemoracao', 'concluida');

  const { project: atual } = await (await request.get(`/api/projects/${project.id}`)).json();
  const finalizeRes = await request.post(`/api/projects/${project.id}/finalize`, {
    headers: HEADERS,
    data: {
      agent: 'Astra',
      expectedRevision: atual.revision,
      idempotencyKey: 'comemoracao-ao-vivo-' + Date.now(),
      summary: 'Tarefa concluída com sucesso pelo agente.',
      humanSummary: 'A tarefa foi concluída ao vivo.',
      nextStep: 'Seguir para a próxima.',
      taskId: task.id,
      taskTransition: { kind: 'declare_done' },
    },
  });
  expect(finalizeRes.ok()).toBeTruthy();

  await page.getByRole('button', { name: 'Atualizar projeto' }).click();
  await expect(card).toHaveAttribute('data-comemoracao', 'concluida');
});

test('Parte 13: primeira carga de projeto com tarefa já concluída não comemora', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Carga Inicial ' + Date.now());
  const task = await criarTarefa(request, project.id, 'Tarefa concluída previamente');
  await concluirTarefa(request, project.id, task.id, {
    agent: 'Astra',
    summary: 'Concluída antes de abrir a página',
    idempotencyKey: 'primeira-carga-' + Date.now(),
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const card = page.locator('.task').filter({ hasText: 'Tarefa concluída previamente' });
  await expect(card).toBeVisible();
  await expect(page.locator('.task[data-comemoracao]')).toHaveCount(0);
});

test('Parte 13: aprovação de proposta exibe linha de confirmação com frase exata e comemoração', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Aprovar Confirmação ' + Date.now());
  await proporAprovacao(request, project.id, {
    agent: 'Grok',
    kind: 'charter_change',
    title: 'Atualizar diretriz principal',
    body: 'Diretriz atualizada para foco em qualidade.',
    rationale: 'Necessidade do projeto.',
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const fila = page.locator('#fila-de-aprovacoes');
  await expect(fila).toBeVisible();
  const card = fila.locator('.fila-card').filter({ hasText: 'Atualizar diretriz principal' });
  await expect(card).toBeVisible();

  await fila.getByLabel('Seu nome, para registrar decisões').fill('Dono do projeto');
  await fila.getByRole('button', { name: 'Salvar nome' }).click();

  await card.getByRole('button', { name: 'Aprovar diretriz', exact: true }).click();
  await card.getByRole('button', { name: 'Aprovar diretriz', exact: true }).click();

  const confirmacao = fila.locator('.fila-confirmacao-decidida[role="status"]');
  await expect(confirmacao).toBeVisible();
  await expect(confirmacao).toHaveAttribute('data-comemoracao', 'aprovada');
  await expect(confirmacao).toContainText('Diretriz aprovada. Ela já vale para todas as IAs.');
});

test('Parte 13: recusa de proposta exibe linha de confirmação com frase exata e sem comemoração', async ({ page, request }) => {
  const project = await criarProjeto(request, 'Projeto Recusar Confirmação ' + Date.now());
  await proporAprovacao(request, project.id, {
    agent: 'Grok',
    kind: 'note',
    title: 'Nota a ser recusada',
    body: 'Texto da nota recusada.',
    rationale: 'Motivo qualquer.',
  });

  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();

  const fila = page.locator('#fila-de-aprovacoes');
  await expect(fila).toBeVisible();
  const card = fila.locator('.fila-card').filter({ hasText: 'Nota a ser recusada' });
  await expect(card).toBeVisible();

  await fila.getByLabel('Seu nome, para registrar decisões').fill('Dono do projeto');
  await fila.getByRole('button', { name: 'Salvar nome' }).click();

  await card.getByRole('button', { name: 'Recusar proposta', exact: true }).click();
  const motivo = card.getByLabel('Motivo da recusa');
  await motivo.fill('Não faz sentido no momento.');
  await card.getByRole('button', { name: 'Recusar proposta', exact: true }).click();

  const confirmacao = fila.locator('.fila-confirmacao-decidida[role="status"]');
  await expect(confirmacao).toBeVisible();
  await expect(confirmacao).not.toHaveAttribute('data-comemoracao');
  await expect(confirmacao).toContainText('Proposta recusada. O motivo ficou registrado.');
});

