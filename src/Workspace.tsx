import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatedTabs } from './AnimatedTabs';
import { useFeedback } from './Feedback';
import { Archive, ArrowDownToLine, ArrowRight, Check, Clock3, FileText, Flag, GitCommitHorizontal, ListTodo, AlertTriangle, CheckCircle2, Copy, Inbox, MailOpen, MessageSquare, NotebookPen, Plus, RefreshCw, Send, ShieldCheck, SlidersHorizontal, AlertCircle, CheckSquare, Square, FileOutput, HelpCircle, History, Shield } from 'lucide-react';
import type { BacklogItem, BacklogPriority, ProjectDetail, Task, Checkpoint, EvidenceView, BlockerTimeline, DecisionTimeline } from '../shared/types';
import type { CharterRevision, Decision, HandoffDelivery, InboxItem, MessageResolution, ProjectBlocker, ResumeBrief, WorkDraft } from '../shared/continuity';
import { ApiError, api, errorText, request } from './api';
import { BotoesDeApagar } from './apagar/BotoesDeApagar';
import { AcceptDecisionDialog, CheckpointDialog, DeleteBacklogItemDialog, DeliverHandoffDialog, FinalizeWorkDialog, MessageDialog, ProposeDecisionDialog, ReopenTaskDialog, ResolveMessageDialog, RevokeDecisionDialog, SupersedeDecisionDialog, TaskContractDialog, WorkDraftDialog, WorkIntentDialog, CrossCheckEvidenceDialog, BlockerTimelineDialog, DecisionTimelineDialog } from './dialogs';
import { DateLabel, EmptyNote } from './ui';
import { LibraryPanel } from './LibraryPanel';
import { GraphPanel } from './GraphPanel';
import { OperationalChangelog } from './OperationalChangelog';
import type { ProjectInsights, StalledTask } from '../shared/insights';
import { ResumoAoAcordar } from './ResumoAoAcordar';
import { FilaDeAprovacoes } from './FilaDeAprovacoes';
import { Retrospectiva } from './retrospectiva/Retrospectiva';
import { Quadro } from './quadro/Quadro';
import { textosDoModo, useModo } from './modo';
import { CopiarParaOutraIA } from './CopiarParaOutraIA';
import { SeloIASumida } from './SeloIASumida';
import { celebrarCriterioCumprido } from './recompensas';
import { OndeParamos } from './onde-paramos/OndeParamos';
import { useCarta } from './onde-paramos/useCarta';
import { abaInicial } from './onde-paramos/texto';
import './comemoracoes.css';

const PRIORITY_LABEL: Record<BacklogPriority, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

function isConflict(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}

export function ProjectWorkspace({ detail, agent, refresh, onExport }: { detail: ProjectDetail; agent: string; refresh: () => Promise<void>; onExport: () => void }) {
  const textosModo = textosDoModo(useModo() ?? 'local');
  const notify = useFeedback();
  // `null` = ainda não se sabe em que aba abrir: projeto parado há 7 dias ou mais abre em "Onde paramos".
  const [tab, setTab] = useState<string | null>(null);
  const carta = useCarta(detail.project.id, detail);
  useEffect(() => {
    if (tab === null && !carta.carregando) setTab(abaInicial(carta.carta?.diasParado ?? null));
  }, [tab, carta.carregando, carta.carta]);
  // Parte 13 — Momento 1: diff de status entre cargas para comemoração ao vivo de tarefa concluída
  const previousTaskStatusesRef = useRef<Map<string, string>>(new Map());
  const lastProjectIdRef = useRef<string | null>(null);
  const [celebratingTaskIds, setCelebratingTaskIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (lastProjectIdRef.current !== detail.project.id) {
      // Ao trocar de projeto ou primeira carga, zera
      lastProjectIdRef.current = detail.project.id;
      previousTaskStatusesRef.current = new Map(detail.tasks.map(t => [t.id, t.status]));
      setCelebratingTaskIds(new Set());
      return;
    }

    // Mesmo projeto: tarefas que estavam com status diferente de 'done' e agora estão 'done'
    const recemConcluidas = new Set<string>();
    for (const task of detail.tasks) {
      const prevStatus = previousTaskStatusesRef.current.get(task.id);
      if (prevStatus !== undefined && prevStatus !== 'done' && task.status === 'done') {
        recemConcluidas.add(task.id);
      }
    }
    previousTaskStatusesRef.current = new Map(detail.tasks.map(t => [t.id, t.status]));

    if (recemConcluidas.size > 0) {
      setCelebratingTaskIds(prev => new Set([...prev, ...recemConcluidas]));
    }
  }, [detail]);

  const handleCelebrationEnd = useCallback((taskId: string) => {
    setCelebratingTaskIds(prev => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }, []);

  // Inteligencia do projeto (Parte 6): buscada uma vez por atualizacao e repassada
  // aos componentes. Fica undefined enquanto nao chega ou se falhar — nunca um valor falso.
  const [insights, setInsights] = useState<ProjectInsights | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    request<ProjectInsights>('/projects/' + detail.project.id + '/insights', undefined, controller.signal, 'GET')
      .then(value => { if (!controller.signal.aborted) setInsights(value); })
      .catch(() => { if (!controller.signal.aborted) setInsights(undefined); });
    return () => controller.abort();
  }, [detail]);
  // Nunca repassa a inteligencia de outro projeto enquanto a deste ainda carrega.
  const insightsDoProjeto = insights?.projectId === detail.project.id ? insights : undefined;
  const tarefasParadas = new Map<string, StalledTask>((insightsDoProjeto?.stalledTasks ?? []).map(item => [item.taskId, item]));
  const [checkpoint, setCheckpoint] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [reopening, setReopening] = useState<Task | null>(null);
  const [intentTask, setIntentTask] = useState<Task | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<WorkDraft | null>(null);
  const [drafts, setDrafts] = useState<WorkDraft[]>([]);
  const [message, setMessage] = useState(false);
  const [deliverCheckpoint, setDeliverCheckpoint] = useState<Checkpoint | null>(null);
  const [contractTask, setContractTask] = useState<Task | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [unreadDeliveryCount, setUnreadDeliveryCount] = useState(0);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [backlogLoading, setBacklogLoading] = useState(true);
  const [backlogError, setBacklogError] = useState('');
  const backlogReady = useRef(false);
  const backlogSeq = useRef(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(false);
  const [decisionsError, setDecisionsError] = useState('');
  const [showDecisionsHistory, setShowDecisionsHistory] = useState(false);
  const [proposeDecisionOpen, setProposeDecisionOpen] = useState(false);
  const [acceptingDecision, setAcceptingDecision] = useState<Decision | null>(null);
  const [revokingDecision, setRevokingDecision] = useState<Decision | null>(null);
  const [supersedingDecision, setSupersedingDecision] = useState<Decision | null>(null);
  // undefined = "ainda não sei": o contador da aba do grafo só aparece
  // depois que o GraphPanel relata um número real. Nunca mostramos 0 no
  // lugar de um valor desconhecido — 0 significa "sem conflitos", não
  // "ainda não verifiquei".
  const [graphIssuesCount, setGraphIssuesCount] = useState<number | undefined>(undefined);
  const [evidenceList, setEvidenceList] = useState<EvidenceView[]>([]);
  const [crossCheckingEvidence, setCrossCheckingEvidence] = useState<EvidenceView | null>(null);
  const checkpoints = [...detail.checkpoints].sort((a, b) => b.revision - a.revision);
  const latest = checkpoints[0];
  const activeTasks = detail.tasks.filter(t => t.leaseUntil && new Date(t.leaseUntil).getTime() > Date.now());
  const loadEvidence = useCallback(async (signal?: AbortSignal) => {
    try {
      const items = await api.evidence(detail.project.id, {}, signal);
      if (signal?.aborted) return;
      setEvidenceList(items);
    } catch {
      if (signal?.aborted) return;
      setEvidenceList([]);
    }
  }, [detail.project.id]);
  const loadBacklog = useCallback(async (signal?: AbortSignal) => {
    const seq = ++backlogSeq.current;
    try {
      const items = await api.backlog(detail.project.id, signal);
      if (signal?.aborted || seq !== backlogSeq.current) return;
      setBacklog(items);
      setBacklogError('');
    } catch (err) {
      if (signal?.aborted || seq !== backlogSeq.current) return;
      setBacklogError(errorText(err));
    }
  }, [detail.project.id]);
  const loadDecisions = useCallback(async (signal?: AbortSignal) => {
    try {
      const items = await api.decisions(detail.project.id, showDecisionsHistory, signal);
      if (signal?.aborted) return;
      setDecisions(items);
      setDecisionsError('');
    } catch (err) {
      if (signal?.aborted) return;
      setDecisionsError(errorText(err));
    }
  }, [detail.project.id, showDecisionsHistory]);
  useEffect(() => {
    if (!agent) { setUnreadDeliveryCount(0); return; }
    const controller = new AbortController();
    request<HandoffDelivery[]>('/projects/' + detail.project.id + '/deliveries?agent=' + encodeURIComponent(agent) + '&unreadOnly=true', undefined, controller.signal)
      .then(items => setUnreadDeliveryCount(items.length))
      .catch(() => { if (!controller.signal.aborted) setUnreadDeliveryCount(0); });
    return () => controller.abort();
  }, [detail.project.id, detail.project.updatedAt, agent]);
  useEffect(() => {
    // O rascunho não entregue só aparece na Visão geral (banner e diálogo de
    // encerrar trabalho); buscar em outra aba seria desperdício.
    if (tab !== 'overview') return;
    if (!agent) { setDrafts([]); return; }
    const controller = new AbortController();
    api.drafts(detail.project.id, agent, controller.signal)
      .then(items => { if (!controller.signal.aborted) setDrafts(items); })
      .catch(() => { if (!controller.signal.aborted) setDrafts([]); });
    return () => controller.abort();
  }, [tab, detail.project.id, detail.project.updatedAt, agent]);
  useEffect(() => {
    const controller = new AbortController();
    if (!backlogReady.current) setBacklogLoading(true);
    loadBacklog(controller.signal).finally(() => {
      if (controller.signal.aborted) return;
      setBacklogLoading(false);
      backlogReady.current = true;
    });
    return () => controller.abort();
  }, [detail.project.id, detail.project.updatedAt, loadBacklog]);
  useEffect(() => {
    const controller = new AbortController();
    setDecisionsLoading(true);
    loadDecisions(controller.signal).finally(() => {
      if (!controller.signal.aborted) setDecisionsLoading(false);
    });
    return () => controller.abort();
  }, [detail.project.id, detail.project.updatedAt, showDecisionsHistory, loadDecisions]);
  // A contagem de conflitos e desatualizações do grafo é medida e reportada
  // pelo próprio GraphPanel (via onIssuesCountChange), que só existe montado
  // quando a aba "Grafo & Inteligência" está aberta. Isso evita um segundo
  // fetch paralelo de /graph/conflicts e /graph/stale nesta camada, redundante
  // com o que o painel já busca sozinho, e para de repeti-lo a cada
  // atualização do workspace com a aba fechada.
  useEffect(() => {
    // Evidência só é exibida nos cartões de checkpoint da aba "Checkpoints";
    // buscar com a aba fechada é trabalho jogado fora.
    if (tab !== 'checkpoints') return;
    const controller = new AbortController();
    loadEvidence(controller.signal);
    return () => controller.abort();
  }, [tab, detail.project.id, detail.project.updatedAt, loadEvidence]);
  const activeBacklogCount = backlog.filter(item => item.stage === 'idea' || item.stage === 'ready').length;
  const activeDecisionsCount = decisions.filter(item => item.status === 'accepted').length;
  async function taskAction(task: Task, action: 'claim' | 'release') {
    setError(''); if (!agent) { setError('Preencha o nome do agente na barra lateral.'); return; }
    setBusy(true); try {
      const result = await request<Task & { overlaps?: Array<{ explanation: string }> }>(`/projects/${detail.project.id}/tasks/${task.id}/${action}`, { agent, expectedVersion: task.version });
      if (action === 'claim') {
        const overlap = result.overlaps?.[0]?.explanation;
        notify(overlap ? 'Tarefa assumida com sobreposição' : 'Tarefa assumida', overlap ?? task.title);
      } else {
        notify('Tarefa liberada', task.title);
      }
      await refresh();
    } catch (e) { setError(errorText(e)); await refresh(); } finally { setBusy(false); }
  }
  async function addTask(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try { await request(`/projects/${detail.project.id}/tasks`, { title: taskTitle }); notify('Tarefa adicionada', taskTitle); setTaskTitle(''); await refresh(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function toggleTaskCriterion(task: Task, criterionIndex: number): Promise<boolean> {
    if (!task.acceptanceCriteria) return false;
    const nextCriteria = task.acceptanceCriteria.map((c, i) =>
      i === criterionIndex ? { ...c, completed: !c.completed } : c
    );
    try {
      await api.updateTaskContract(detail.project.id, task.id, {
        expectedVersion: task.version,
        acceptanceCriteria: nextCriteria,
      });
      notify('Critério atualizado', nextCriteria[criterionIndex]?.completed ? 'Critério marcado como concluído.' : 'Critério desmarcado.');
      await refresh();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  }
  return <>
    <div className="project-meta"><span><span className="tiny-dot"/>{textosModo.salvo}</span><span className="mono-label">versão {detail.project.revision}</span>{detail.project.workspacePath && <span className="workspace-path" title={detail.project.workspacePath}>{detail.project.workspacePath}</span>}<span className="meta-date">Atualizado <DateLabel value={detail.project.updatedAt}/></span></div>
    <AnimatedTabs value={tab ?? ''} onChange={setTab} items={[{ id: 'carta', label: 'Onde paramos' }, { id: 'overview', label: 'Visão geral' }, { id: 'board', label: 'Quadro' }, { id: 'retrospective', label: 'Retrospectiva' }, { id: 'graph', label: 'Relações', count: graphIssuesCount }, { id: 'library', label: 'Biblioteca' }, { id: 'backlog', label: 'Backlog', count: activeBacklogCount }, { id: 'decisions', label: 'Decisões', count: activeDecisionsCount }, { id: 'checkpoints', label: 'Checkpoints', count: checkpoints.length }, { id: 'messages', label: 'Mensagens', count: detail.messages.length + unreadDeliveryCount }, { id: 'resume', label: 'Retomar' }]}/>
    {error && <div role="alert" className="alert">{error}</div>}
    <div className={'workspace-grid' + (tab === 'carta' || tab === 'library' || tab === 'graph' || tab === 'retrospective' || tab === 'board' ? ' is-wide' : '')} role="tabpanel" id="project-tabpanel" aria-labelledby={tab ? `tab-${tab}` : undefined}>
      <div className="workspace-primary">
        {tab === null && <div className="loading" role="status"><RefreshCw size={18}/>Abrindo o projeto…</div>}
        {tab === 'carta' && <OndeParamos projectId={detail.project.id} estado={carta} aoConfirmarDecisao={refresh}/>}
        {tab === 'board' && <Quadro projectId={detail.project.id} atualizadoEm={detail}/>}
        {tab === 'retrospective' && <Retrospectiva detail={detail}/>}
        {tab === 'overview' && <>
          <ResumoAoAcordar projectId={detail.project.id} detail={detail} insights={insightsDoProjeto} onOpenApprovals={() => document.getElementById('fila-de-aprovacoes')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })}/>
          <FilaDeAprovacoes projectId={detail.project.id} onDecided={() => void refresh()}/>
          <section className="resume-card"><div className="resume-card-top"><span className="eyebrow"><GitCommitHorizontal size={16}/>PRÓXIMO PASSO</span><span className="resume-revision">{latest ? `versão ${latest.revision}` : 'AINDA NÃO SALVO'}</span></div><h2>{latest ? latest.nextStep : 'Nenhum próximo passo'}</h2><p>{latest ? latest.summary : 'Salve o que foi feito e a próxima ação para continuar depois.'}</p>{!agent && <div className="resume-card-hint-row"><span className="agent-warning-hint" role="status">Informe o nome na barra lateral para salvar rascunho ou encerrar trabalho.</span></div>}<div className="resume-card-footer"><div className="resume-card-footer-author">{latest ? <span>Salvo por {latest.agent} · <DateLabel value={latest.createdAt}/></span> : <span>O histórico começa no primeiro checkpoint.</span>}</div><div className="resume-card-actions"><button type="button" onClick={() => { setEditingDraft(null); setDraftOpen(true); }} disabled={!agent} title={!agent ? 'Informe o nome na barra lateral' : undefined}>Salvar rascunho<NotebookPen size={16}/></button><button type="button" onClick={() => setFinalizeOpen(true)} disabled={!agent} title={!agent ? 'Informe o nome na barra lateral' : undefined}>Encerrar trabalho<Send size={16}/></button><button onClick={() => setCheckpoint(true)}>{latest ? 'Novo checkpoint' : 'Salvar primeiro checkpoint'}<Plus size={16}/></button></div></div></section>
          {drafts.length > 0 && <section className="draft-card" aria-label="Rascunho não entregue">{drafts.map(draft => {
            const taskTitle = draft.taskId ? detail.tasks.find(task => task.id === draft.taskId)?.title : null;
            return <article key={draft.id} className="draft-entry">
              <div className="draft-card-top"><span className="eyebrow"><NotebookPen size={14}/>RASCUNHO NÃO ENTREGUE</span><span>v{draft.version}</span></div>
              <h3>{draft.nextAction}</h3>
              <p>{draft.summary}</p>
              <p className="draft-warning">Este rascunho não substitui um checkpoint.</p>
              <div className="draft-card-footer">
                <span>Relatado por {draft.actorId}{taskTitle ? ` · ${taskTitle}` : ''} · <DateLabel value={draft.updatedAt}/></span>
                <div className="draft-card-actions">
                  <button type="button" className="text-button" onClick={() => { setEditingDraft(draft); setDraftOpen(true); }}>Atualizar</button>
                  <button type="button" className="text-button" onClick={() => void (async () => {
                    setError('');
                    try {
                      await api.discardWorkDraft(detail.project.id, { agent, expectedVersion: draft.version, taskId: draft.taskId });
                      notify('Rascunho descartado', 'O checkpoint permanece intacto.');
                      await refresh();
                    } catch (err) { setError(errorText(err)); }
                  })()}>Descartar rascunho</button>
                </div>
              </div>
            </article>;
          })}</section>}
          <OperationalChangelog detail={detail} agent={agent} decisions={decisions} />
          <CharterPanel projectId={detail.project.id} agent={agent} refresh={refresh}/>
          <BlockersPanel projectId={detail.project.id} agent={agent} refresh={refresh}/>
          <section className="panel"><div className="panel-heading"><h2>Memória do projeto</h2><span className="mono-label">O QUE IMPORTA AGORA</span></div><div className="memory-columns"><div><span className="memory-label"><Flag size={15}/>Decisões recentes</span>{latest?.decisions.length ? <ul>{latest.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul> : <p className="subtle-text">Nenhuma decisão registrada no último checkpoint.</p>}</div><div><span className="memory-label"><Clock3 size={15}/>Pontos de atenção</span>{latest?.blockers.length ? <ul>{latest.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul> : <p className="subtle-text">{latest ? 'Nenhum bloqueio declarado no último checkpoint.' : 'Bloqueios e incertezas ficam registrados aqui.'}</p>}</div></div></section>
          <section className="activity-section"><div className="panel-heading"><h2>Últimos checkpoints</h2><button className="text-button" onClick={() => setTab('checkpoints')}>Ver checkpoints<ArrowRight size={14}/></button></div>{checkpoints.length === 0 ? <EmptyNote><GitCommitHorizontal size={20}/><p>Nenhum checkpoint ainda.<br/><span>Salve um checkpoint para começar o histórico.</span></p></EmptyNote> : <div className="timeline">{checkpoints.slice(0, 3).map(cp => <div className="timeline-item" key={cp.id}><span className="timeline-dot"/><div><div className="timeline-meta"><strong>{cp.agent}</strong><span>salvou a versão {cp.revision}</span><DateLabel value={cp.createdAt}/></div><p>{cp.summary}</p></div></div>)}</div>}</section>
        </>}
        {tab === 'graph' && <GraphPanel projectId={detail.project.id} agent={agent} onNavigateTab={setTab} onIssuesCountChange={setGraphIssuesCount}/>}
        {tab === 'library' && <LibraryPanel projectId={detail.project.id} agent={agent}/>}
        {tab === 'backlog' && <BacklogPanel projectId={detail.project.id} agent={agent} items={backlog} loading={backlogLoading} error={backlogError} onReload={loadBacklog} refresh={refresh}/>}
        {tab === 'decisions' && <DecisionsPanel projectId={detail.project.id} agent={agent} decisions={decisions} loading={decisionsLoading} error={decisionsError} showHistory={showDecisionsHistory} onToggleHistory={() => setShowDecisionsHistory(prev => !prev)} onPropose={() => setProposeDecisionOpen(true)} onAccept={setAcceptingDecision} onRevoke={setRevokingDecision} onSupersede={setSupersedingDecision} onReload={loadDecisions}/>}
        {tab === 'checkpoints' && <><div className="section-heading"><div><h2>Checkpoints</h2><p>Histórico do progresso salvo neste projeto.</p></div><button className="button primary" onClick={() => setCheckpoint(true)}><Plus size={16}/>Novo checkpoint</button></div>{checkpoints.length ? checkpoints.map(cp => <CheckpointCard key={cp.id} checkpoint={cp} agent={agent} evidenceViews={evidenceList} onCrossCheck={setCrossCheckingEvidence} taskTitle={detail.tasks.find(task => task.id === cp.taskId)?.title} onDeliver={setDeliverCheckpoint} onApagado={refresh}/>) : <EmptyNote><FileText size={25}/><p>Nenhum checkpoint ainda.</p><button className="text-button" onClick={() => setCheckpoint(true)}>Salvar primeiro checkpoint<ArrowRight size={14}/></button></EmptyNote>}</>}
        {tab === 'messages' && <><div className="mailbox-overview"><DeliveriesPanel projectId={detail.project.id} agent={agent} onUnreadCountChange={setUnreadDeliveryCount}/><InboxPanel projectId={detail.project.id} agent={agent}/></div><div className="section-heading"><div><h2>Mensagens do projeto</h2><p>Recados que qualquer agente pode consultar depois.</p></div><button className="button primary" onClick={() => setMessage(true)}><Plus size={16}/>Nova mensagem</button></div>{detail.messages.length ? <div className="messages">{[...detail.messages].reverse().map(m => <article className="message-card" key={m.id}><div className="message-meta"><span className="message-avatar">{m.from.slice(0, 1).toUpperCase()}</span><strong>{m.from}</strong><ArrowRight size={13}/><span>{m.to}</span><span className="message-kind">{{ note: 'Nota', question: 'Pergunta', review: 'Revisão', handoff: 'Passagem' }[m.kind]}</span></div><p>{m.body}</p><DateLabel value={m.createdAt}/></article>)}</div> : <div className="messages-empty"><EmptyNote><MessageSquare size={20}/><p>Nenhuma mensagem ainda.</p><button className="text-button" onClick={() => setMessage(true)}>Escrever uma mensagem<ArrowRight size={14}/></button></EmptyNote></div>}</>}
        {tab === 'resume' && <><CopiarParaOutraIA projectId={detail.project.id} agent={agent}/><AgentResume projectId={detail.project.id} agent={agent} tasks={detail.tasks} onExport={onExport} onUnreadCountChange={setUnreadDeliveryCount}/></>}
      </div>
      <aside className="workspace-secondary">
        <section className="panel tasks-panel">
          <div className="tasks-header-sticky">
            <div className="panel-heading">
              <h2><ListTodo size={17}/>Tarefas</h2>
              <span className="count-badge">{detail.tasks.length}</span>
            </div>
            {detail.tasks.length > 0 && (
              <div className="projeto-progresso-container" role="status" aria-label={`Progresso: ${detail.tasks.filter(t => t.status === 'done').length} de ${detail.tasks.length} concluídas`}>
                <span className="projeto-progresso-rotulo">{detail.tasks.filter(t => t.status === 'done').length} de {detail.tasks.length} concluídas</span>
                <div className="projeto-progresso-barra">
                  <div
                    className="projeto-progresso-preenchimento"
                    style={{ width: `${Math.round((detail.tasks.filter(t => t.status === 'done').length / detail.tasks.length) * 100)}%` }}
                  />
                </div>
                <span className="projeto-progresso-porcentagem">{Math.round((detail.tasks.filter(t => t.status === 'done').length / detail.tasks.length) * 100)}%</span>
              </div>
            )}
            <div className="tasks-summary">
              {activeTasks.length > 0 ? `${activeTasks.length} ${activeTasks.length === 1 ? 'tarefa com responsável' : 'tarefas com responsável'}` : 'Nenhuma tarefa assumida.'}
            </div>
          </div>
          <div className="task-list">
            {detail.tasks.length === 0 ? (
              <p className="subtle-text task-empty">Divida o objetivo em ações que uma IA possa assumir.</p>
            ) : detail.tasks.map(task => (
              <TaskItem
                key={task.id}
                task={task}
                stalled={tarefasParadas.get(task.id)}
                agent={agent}
                busy={busy}
                detailTasks={detail.tasks}
                onContract={setContractTask}
                onReopen={setReopening}
                onTaskAction={taskAction}
                onIntent={setIntentTask}
                onToggleCriterion={toggleTaskCriterion}
                celebrating={celebratingTaskIds.has(task.id)}
                onCelebrationEnd={handleCelebrationEnd}
              />
            ))}
          </div>
          <form className="task-form" onSubmit={addTask}>
            <label htmlFor="task-title">Título da tarefa</label>
            <input id="task-title" placeholder="O que precisa ser feito?" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} disabled={busy} required maxLength={200}/>
            <button className="button secondary" disabled={busy || !taskTitle.trim()}><Plus size={15}/>Adicionar tarefa</button>
          </form>
        </section>
        <div className="trust-note">
          <ShieldCheck size={18}/>
          <p><strong>Evidências declaradas</strong> Testes informados por um agente são relatos. A verificação automática ainda não faz parte desta versão.</p>
        </div>
      </aside>
    </div>
    {checkpoint && <CheckpointDialog detail={detail} agent={agent} onClose={() => setCheckpoint(false)} onSaved={async () => { setCheckpoint(false); await refresh(); }} refresh={refresh}/>}
    {finalizeOpen && <FinalizeWorkDialog detail={detail} agent={agent} drafts={drafts} onClose={() => setFinalizeOpen(false)} onSaved={async () => { setFinalizeOpen(false); await refresh(); }} refresh={refresh}/>}
    {reopening && <ReopenTaskDialog projectId={detail.project.id} agent={agent} task={reopening} onClose={() => setReopening(null)} onSaved={async () => { setReopening(null); await refresh(); }}/>}
    {intentTask && <WorkIntentDialog projectId={detail.project.id} agent={agent} task={intentTask} onClose={() => setIntentTask(null)} onSaved={async (overlaps) => { setIntentTask(null); if (overlaps[0]) setError(overlaps[0].explanation); await refresh(); }}/>}
    {draftOpen && <WorkDraftDialog detail={detail} agent={agent} draft={editingDraft} onClose={() => { setDraftOpen(false); setEditingDraft(null); }} onSaved={async () => { setDraftOpen(false); setEditingDraft(null); await refresh(); }}/>}
    {contractTask && <TaskContractDialog projectId={detail.project.id} task={contractTask} tasks={detail.tasks} onClose={() => setContractTask(null)} onSaved={async () => { setContractTask(null); await refresh(); }}/>}
    {message && <MessageDialog projectId={detail.project.id} agent={agent} onClose={() => setMessage(false)} onSaved={async () => { setMessage(false); await refresh(); }}/>}
    {deliverCheckpoint && <DeliverHandoffDialog projectId={detail.project.id} agent={agent} checkpoint={deliverCheckpoint} taskTitle={detail.tasks.find(task => task.id === deliverCheckpoint.taskId)?.title} onClose={() => setDeliverCheckpoint(null)} onSaved={async () => { setDeliverCheckpoint(null); await refresh(); }}/>}
    {proposeDecisionOpen && <ProposeDecisionDialog projectId={detail.project.id} agent={agent} onClose={() => setProposeDecisionOpen(false)} onSaved={async () => { setProposeDecisionOpen(false); await refresh(); await loadDecisions(); }}/>}
    {acceptingDecision && <AcceptDecisionDialog projectId={detail.project.id} agent={agent} decision={acceptingDecision} onClose={() => setAcceptingDecision(null)} onSaved={async () => { setAcceptingDecision(null); await refresh(); await loadDecisions(); }}/>}
    {revokingDecision && <RevokeDecisionDialog projectId={detail.project.id} agent={agent} decision={revokingDecision} onClose={() => setRevokingDecision(null)} onSaved={async () => { setRevokingDecision(null); await refresh(); await loadDecisions(); }}/>}
    {supersedingDecision && <SupersedeDecisionDialog projectId={detail.project.id} agent={agent} decision={supersedingDecision} onClose={() => setSupersedingDecision(null)} onSaved={async () => { setSupersedingDecision(null); await refresh(); await loadDecisions(); }}/>}
    {crossCheckingEvidence && (
      <CrossCheckEvidenceDialog
        projectId={detail.project.id}
        agent={agent}
        evidence={crossCheckingEvidence}
        onClose={() => setCrossCheckingEvidence(null)}
        onSaved={async () => {
          setCrossCheckingEvidence(null);
          await loadEvidence();
          await refresh();
        }}
      />
    )}
  </>;
}

function TaskItem({
  task,
  agent,
  busy,
  detailTasks,
  onContract,
  onReopen,
  onTaskAction,
  onIntent,
  onToggleCriterion,
  stalled,
  celebrating,
  onCelebrationEnd,
}: {
  task: Task;
  stalled: StalledTask | undefined;
  agent: string;
  busy: boolean;
  detailTasks: Task[];
  onContract: (task: Task) => void;
  onReopen: (task: Task) => void;
  onTaskAction: (task: Task, action: 'claim' | 'release') => void;
  onIntent: (task: Task) => void;
  onToggleCriterion: (task: Task, index: number) => Promise<boolean>;
  celebrating?: boolean;
  onCelebrationEnd?: (taskId: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [comemorando, setComemorando] = useState(false);

  useEffect(() => {
    if (celebrating) {
      setComemorando(true);
      const timer = setTimeout(() => {
        setComemorando(false);
        onCelebrationEnd?.(task.id);
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      setComemorando(false);
    }
  }, [celebrating, task.id, onCelebrationEnd]);

  const live = !!task.leaseUntil && new Date(task.leaseUntil).getTime() > Date.now();
  const mine = live && task.assignee === agent;
  const closed = task.status === 'blocked' || task.status === 'done';
  const isDone = task.status === 'done';
  const unmetDeps = (task.dependencyTaskIds || [])
    .map(depId => detailTasks.find(t => t.id === depId))
    .filter((t): t is Task => !!t && t.status !== 'done');
  const hasUnmetDeps = unmetDeps.length > 0 && !closed;
  const criteria = task.acceptanceCriteria || [];
  const completedCriteriaCount = criteria.filter(c => c.completed).length;

  return (
    <article
      className={`task${isDone ? (showDetails ? ' is-done is-expanded' : ' is-done is-collapsed') : ''}`}
      key={task.id}
      data-comemoracao={comemorando ? 'concluida' : undefined}
    >
      <div className="task-header-row">
        <div className="task-title">
          <span className={`task-indicator ${live && !closed ? 'running' : ''} ${task.status === 'done' ? 'done' : ''} ${task.status === 'blocked' ? 'blocked' : ''}`} />
          <h3>{task.title}</h3>
        </div>
        <div className="task-header-badges">
          <SeloIASumida stalled={stalled}/>
          {task.priority && task.priority !== 'medium' && (
            <span className={`task-priority-badge priority-${task.priority}`}>
              {PRIORITY_LABEL[task.priority] || task.priority}
            </span>
          )}
          {(!isDone || showDetails) && (
            <button
              type="button"
              className="task-contract-btn"
              onClick={() => onContract(task)}
              title="Ver e editar detalhes da tarefa"
            >
              <SlidersHorizontal size={11} />
              <span>Detalhes</span>
            </button>
          )}
        </div>
      </div>

      {(!isDone || showDetails) && task.description && (
        <p className="task-description-snippet">{task.description}</p>
      )}

      {hasUnmetDeps && (
        <div className="task-dep-alert">
          <AlertCircle size={12} />
          <span>Bloqueada por: {unmetDeps.map(d => d.title).join(', ')}</span>
        </div>
      )}

      {(!isDone || showDetails) && criteria.length > 0 && (
        <div className="task-criteria-section">
          <div className="criteria-header">
            <span className="criteria-label">Critérios ({completedCriteriaCount}/{criteria.length})</span>
            <div className="criteria-progress-bar">
              <div
                className="criteria-progress-fill"
                style={{ width: `${Math.round((completedCriteriaCount / criteria.length) * 100)}%` }}
              />
            </div>
          </div>
          <div className="task-criteria-chips">
            {criteria.map((c, idx) => (
              <button
                key={c.id || idx}
                type="button"
                className={`task-criterion-chip ${c.completed ? 'completed' : ''}`}
                onClick={async (e) => {
                  const el = e.currentTarget;
                  const wasPending = !c.completed;
                  const ok = await onToggleCriterion(task, idx);
                  if (ok && wasPending && el.isConnected) {
                    celebrarCriterioCumprido(el);
                  }
                }}
                title={c.completed ? 'Marcar critério como pendente' : 'Marcar critério como concluído'}
              >
                {c.completed ? <CheckSquare size={12} /> : <Square size={12} />}
                <span>{c.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(!isDone || showDetails) && task.expectedOutputs && task.expectedOutputs.length > 0 && (
        <div className="task-outputs-chips">
          {task.expectedOutputs.map((out, idx) => (
            <span key={out.id || idx} className="task-output-chip" title={out.locator || out.title}>
              <FileOutput size={11} />
              <span className="output-kind-tag">{{
                file_path: 'Arquivo',
                content_item: 'Item',
                artifact: 'Artefato',
                design_asset: 'Design',
                dataset: 'Dados',
                other: 'Outro'
              }[out.kind] || out.kind}</span>
              <strong>{out.title}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="task-owner">
        {task.status === 'done' ? (
          <span>Concluída</span>
        ) : task.status === 'blocked' ? (
          <span>Bloqueada{task.blockedReason ? ` · ${task.blockedReason}` : ''}</span>
        ) : live ? (
          <>
            <span>{task.assignee} · em andamento</span>
            <small>Até {new Date(task.leaseUntil!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
          </>
        ) : (
          <span>{task.assignee ? 'Concessão expirada' : 'Disponível para assumir'}</span>
        )}
      </div>

      <div className="task-actions">
        {closed ? (
          <>
            <button
              type="button"
              className="task-reopen-btn"
              disabled={busy || !agent}
              title={!agent ? 'Informe o nome na barra lateral' : undefined}
              onClick={() => onReopen(task)}
            >
              Reabrir tarefa
            </button>
            {isDone && (
              <button
                type="button"
                className="text-button task-details-toggle"
                onClick={() => setShowDetails(prev => !prev)}
              >
                {showDetails ? 'Recolher detalhes' : 'Ver detalhes'}
              </button>
            )}
          </>
        ) : mine ? (
          <>
            <button disabled={busy} onClick={() => void onTaskAction(task, 'claim')} aria-label={`Renovar tarefa ${task.title}`}><RefreshCw size={12}/>Renovar</button>
            <button type="button" disabled={busy} onClick={() => onIntent(task)}>Declarar intenção</button>
            <button disabled={busy} onClick={() => void onTaskAction(task, 'release')} aria-label={`Liberar tarefa ${task.title}`}>Liberar</button>
          </>
        ) : (
          <button disabled={busy || live || !agent || hasUnmetDeps} title={!agent ? 'Informe o nome na barra lateral' : undefined} onClick={() => void onTaskAction(task, 'claim')}>
            {hasUnmetDeps ? 'Dependência pendente' : live ? 'Em uso por outro agente' : 'Assumir tarefa'}
            {!live && !hasUnmetDeps && <ArrowRight size={12}/>}
          </button>
        )}
      </div>
    </article>
  );
}

function CheckpointCard({
  checkpoint: cp,
  agent,
  evidenceViews = [],
  onDeliver,
  onCrossCheck,
  onApagado,
}: {
  checkpoint: Checkpoint;
  agent: string;
  taskTitle?: string;
  evidenceViews?: EvidenceView[];
  onDeliver: (checkpoint: Checkpoint) => void;
  onCrossCheck?: (evidence: EvidenceView) => void;
  onApagado: () => Promise<void>;
}) {
  const mine = Boolean(agent) && cp.agent === agent;

  const checkpointViews: EvidenceView[] = evidenceViews.filter(v => v.checkpointId === cp.id);
  const relevantViews: EvidenceView[] = checkpointViews.length > 0
    ? checkpointViews
    : (cp.evidence.length === 0 && evidenceViews.length > 0)
      ? evidenceViews
      : cp.evidence.map((e, i) => {
          const found = evidenceViews.find(v => v.command === e.command || v.position === i);
          return found || {
            id: `ev-${cp.id}-${i}`,
            projectId: cp.projectId,
            checkpointId: cp.id,
            position: i,
            command: e.command,
            outcome: e.outcome,
            details: e.details,
            reportedBy: cp.agent,
            provenance: 'agent_report' as const,
            createdAt: cp.createdAt,
            assertions: ['agent_reported' as const],
            freshness: 'no_artifacts' as const,
            explanation: '',
            artifacts: [],
            verifications: [],
          };
        });

  return (
    <article className="checkpoint-card">
      <div className="checkpoint-meta">
        <span className="revision-badge">versão {cp.revision}</span>
        <strong>{cp.agent}</strong>
        <DateLabel value={cp.createdAt} />
      </div>
      <h3>{cp.summary}</h3>
      <div className="checkpoint-next">
        <ArrowRight size={16} />
        <div>
          <span>PRÓXIMO PASSO</span>
          <p>{cp.nextStep}</p>
        </div>
      </div>
      {cp.decisions.length > 0 && (
        <div className="checkpoint-details">
          <strong>Decisões</strong>
          <ul>{cp.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </div>
      )}
      {cp.blockers.length > 0 && (
        <div className="checkpoint-details">
          <strong>Bloqueios</strong>
          <ul>{cp.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {relevantViews.map((ev, i) => {
        const isStale = ev.freshness === 'stale';
        const isMissing = ev.freshness === 'missing';
        const isUnverifiable = ev.freshness === 'unverifiable';
        const hasWarning = isStale || isMissing || isUnverifiable;

        return (
          <div
            key={ev.id || i}
            className={`evidence ${isStale ? 'evidence-stale' : ''} ${hasWarning ? 'has-warning' : ''}`}
          >
            <div className="evidence-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '10px', flexWrap: 'wrap' }}>
              <div className="evidence-assertions" style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="status-tag neutral assertion-tag">Informado pela IA</span>
                {(ev.assertions?.includes('cross_checked') || (ev.verifications && ev.verifications.length > 0)) && (
                  <span className="status-tag info assertion-tag" style={{ background: '#1c3247', borderColor: '#2e5984', color: '#7bc3f7' }}>
                    Conferido por outra IA ({ev.verifications?.length || 1})
                  </span>
                )}
                {ev.assertions?.includes('artifact_bound') && (
                  <span className="status-tag system assertion-tag" style={{ background: '#2f2540', borderColor: '#5c4280', color: '#caa6f7' }}>
                    Arquivos conferidos pelo sistema
                  </span>
                )}
              </div>
              <span className={`status-tag micro outcome-tag ${ev.outcome}`}>
                {{ passed: 'Sucesso informado', failed: 'Falha informada', not_run: 'Não executado' }[ev.outcome] || ev.outcome}
              </span>
            </div>

            <div className="evidence-cmd" style={{ marginTop: '6px', width: '100%' }}>
              <code>{ev.command}</code>
            </div>

            {ev.details && <p className="evidence-details-text" style={{ margin: '4px 0 0' }}>{ev.details}</p>}

            {/* Explicação de frescor em português direto */}
            {isStale && (
              <div className="evidence-freshness-alert stale" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: '#38201a', border: '1px solid #7d3525', borderRadius: '5px', width: '100%', marginTop: '8px' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>{ev.explanation || 'Esta evidência não cobre a versão atual: arquivos mudaram desde a medição.'}</span>
              </div>
            )}
            {isMissing && (
              <div className="evidence-freshness-alert missing" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: '#38201a', border: '1px solid #7d3525', borderRadius: '5px', width: '100%', marginTop: '8px' }}>
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{ev.explanation || 'Arquivo declarado não existe mais no caminho informado.'}</span>
              </div>
            )}
            {isUnverifiable && (
              <div className="evidence-freshness-alert unverifiable" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: '#353020', border: '1px solid #73622b', borderRadius: '5px', width: '100%', marginTop: '8px' }}>
                <HelpCircle size={15} style={{ flexShrink: 0 }} />
                <span>{ev.explanation || 'Não foi possível conferir os arquivos.'}</span>
              </div>
            )}

            {/* Arquivos conferidos */}
            {ev.artifacts && ev.artifacts.length > 0 && (
              <div className="evidence-artifacts-block" style={{ width: '100%', marginTop: '8px', borderTop: '1px solid #3c4147', paddingTop: '8px' }}>
                <span className="evidence-section-subtitle" style={{ fontWeight: 600, display: 'block', marginBottom: '6px' }}>Arquivos conferidos</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {ev.artifacts.map((art, aIdx) => (
                    <div key={art.id || aIdx} className="evidence-artifact-row" style={{ background: '#191b1e', padding: '6px 10px', borderRadius: '4px', border: '1px solid #373c43' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                        <code className="evidence-artifact-path">{art.path}</code>
                        <span className={`status-tag micro evidence-artifact-status ${art.freshness === 'covers_current' ? 'success' : art.freshness === 'stale' ? 'stale' : 'neutral'}`}>
                          {{ covers_current: 'Atual', stale: 'Desatualizada', missing: 'Arquivo não encontrado', unverifiable: 'Não foi possível conferir' }[art.freshness] || art.freshness}
                        </span>
                      </div>
                      {art.reason && <p className="evidence-artifact-reason" style={{ margin: '3px 0 0' }}>{art.reason}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Conferências cruzadas */}
            {ev.verifications && ev.verifications.length > 0 && (
              <div className="evidence-verifications-block" style={{ width: '100%', marginTop: '8px', borderTop: '1px solid #3c4147', paddingTop: '8px' }}>
                <span className="evidence-section-subtitle" style={{ fontWeight: 600, display: 'block', marginBottom: '6px' }}>Conferências de outras IAs</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {ev.verifications.map((ver, vIdx) => (
                    <div key={ver.id || vIdx} className="verification-item" style={{ background: '#1c222b', padding: '8px 10px', borderRadius: '4px', border: '1px solid #2e3c4e' }}>
                      <div className="verification-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Conferido por <strong>{ver.verifiedBy}</strong></span>
                        {ver.createdAt && <DateLabel value={ver.createdAt} />}
                      </div>
                      <p className="verification-note" style={{ margin: '4px 0 0' }}>{ver.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {onCrossCheck && (
              <div className="evidence-actions" style={{ marginTop: '10px', width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="button secondary cross-check-btn"
                  style={{ padding: '6px 10px', minHeight: '28px' }}
                  onClick={() => onCrossCheck(ev)}
                  title="Conferir este teste com outra identidade declarada"
                >
                  <CheckCircle2 size={13} />
                  Conferir evidência
                </button>
              </div>
            )}
          </div>
        );
      })}
      {mine && (
        <div className="checkpoint-actions">
          <button className="button secondary" onClick={() => onDeliver(cp)}>
            <Send size={15} />
            Entregar para outra IA
          </button>
        </div>
      )}
      <BotoesDeApagar projectId={cp.projectId} checkpointId={cp.id} onApagado={onApagado} />
    </article>
  );
}


function InboxPanel({ projectId, agent }: { projectId: string; agent: string }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [resolving, setResolving] = useState<InboxItem | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!agent) { setItems([]); return; }
    const controller = new AbortController();
    setLoading(true);
    request<InboxItem[]>('/projects/' + projectId + '/inbox?agent=' + encodeURIComponent(agent), undefined, controller.signal)
      .then(setItems).catch(err => { if (!controller.signal.aborted) setError(errorText(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, agent]);
  async function acknowledge(item: InboxItem) {
    try {
      await request('/projects/' + projectId + '/messages/' + item.message.id + '/ack', { agent });
      setItems(current => current.map(value => value.message.id === item.message.id ? { ...value, acknowledgedAt: new Date().toISOString() } : value));
    } catch (err) { setError(errorText(err)); }
  }
  function resolved(resolution: MessageResolution) {
    setItems(current => current.map(value => value.message.id === resolution.messageId ? { ...value, resolution } : value));
    setResolving(null);
  }
  const pendingCount = items.filter(item => (item.message.kind === 'question' || item.message.kind === 'review') && !item.resolution).length;
  return <section className="inbox-panel" role="region" aria-label={'Caixa de entrada de ' + (agent || 'agente não informado')}>
    <div className="inbox-heading"><div><span className="eyebrow"><Inbox size={15}/>PARA ESTE AGENTE</span><h2>Caixa de entrada</h2></div>{agent && <div className="inbox-counts"><span className="count-badge">{items.filter(item => !item.acknowledgedAt).length} novas</span>{pendingCount > 0 && <span className="count-badge attention-count">{pendingCount} {pendingCount === 1 ? 'pendente' : 'pendentes'}</span>}</div>}</div>
    {!agent ? <p className="subtle-text">Informe seu nome de agente na barra lateral para consultar mensagens diretas e avisos gerais.</p> :
      loading ? <p className="subtle-text">Consultando mensagens…</p> :
      items.length === 0 ? <p className="subtle-text">Nada pendente para {agent}.</p> :
      <div className="inbox-list">{[...items].reverse().map(item => {
        const resolvable = item.message.kind === 'question' || item.message.kind === 'review';
        const className = ['inbox-item', item.acknowledgedAt ? 'is-read' : '', item.resolution ? 'is-resolved' : '', resolvable && !item.resolution ? 'has-open-attention' : ''].filter(Boolean).join(' ');
        return <article key={item.message.id} className={className}>
          <div className="inbox-copy"><span>{item.message.from}</span><strong>{item.message.body}</strong><small>{item.message.kind === 'review' ? 'Revisão solicitada' : item.message.kind === 'handoff' ? 'Passagem de trabalho' : item.message.kind === 'question' ? 'Pergunta' : 'Nota'}</small>{item.resolution && <div className="resolution-note"><span><CheckCircle2 size={13}/>Resolvida</span><p>{item.resolution.note || 'Desfecho registrado por referência.'}</p></div>}</div>
          <div className="inbox-actions">{item.acknowledgedAt ? <span className="read-state"><CheckCircle2 size={14}/>Lida</span> : <button className="button secondary" onClick={() => void acknowledge(item)}>Marcar como lida</button>}{resolvable && !item.resolution && <button className="button resolve-button" onClick={() => setResolving(item)}>Resolver</button>}</div>
        </article>;
      })}</div>}
    {error && <div className="alert" role="alert">{error}</div>}
    {resolving && <ResolveMessageDialog projectId={projectId} agent={agent} item={resolving} onClose={() => setResolving(null)} onResolved={resolved}/>} 
  </section>;
}

function DeliveryCard({ delivery, onAcknowledge }: { delivery: HandoffDelivery; onAcknowledge: (delivery: HandoffDelivery) => void }) {
  const guidance = delivery.message || delivery.checkpoint.nextStep;
  return <article className={delivery.acknowledgedAt ? 'delivery-card is-read' : 'delivery-card'}>
    <div className="delivery-meta"><span className="revision-badge">versão {delivery.checkpoint.revision}</span><strong>{delivery.from}</strong><ArrowRight size={13}/><span>{delivery.to}</span><DateLabel value={delivery.createdAt}/></div>
    {delivery.task && <p className="delivery-task">Tarefa · {delivery.task.title}</p>}
    <div className="delivery-grid">
      <div><span>Trabalho concluído</span><p>{delivery.checkpoint.summary}</p></div>
      <div><span>Próximo passo</span><p>{delivery.checkpoint.nextStep}</p></div>
    </div>
    <div className="delivery-message"><span>Mensagem para a próxima IA</span><p>{guidance}</p></div>
    <div className="delivery-status">
      {delivery.acknowledgedAt ? <span className="read-state"><CheckCircle2 size={14}/>Lida</span> : <><span className="unread-state">Não lida</span><button className="button secondary" onClick={() => onAcknowledge(delivery)}>Confirmar leitura</button></>}
    </div>
  </article>;
}

function DeliveriesPanel({ projectId, agent, onUnreadCountChange }: { projectId: string; agent: string; onUnreadCountChange: (count: number) => void }) {
  const [items, setItems] = useState<HandoffDelivery[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!agent) { setItems([]); setError(''); return; }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request<HandoffDelivery[]>('/projects/' + projectId + '/deliveries?agent=' + encodeURIComponent(agent), undefined, controller.signal)
      .then(setItems).catch(err => { if (!controller.signal.aborted) setError(errorText(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, agent]);
  useEffect(() => {
    onUnreadCountChange(items.filter(item => !item.acknowledgedAt).length);
  }, [items, onUnreadCountChange]);
  async function acknowledge(item: HandoffDelivery) {
    try {
      const receipt = await request<{ acknowledgedAt: string }>('/projects/' + projectId + '/deliveries/' + item.id + '/ack', { agent });
      setItems(current => current.map(value => value.id === item.id ? { ...value, acknowledgedAt: receipt.acknowledgedAt } : value));
    } catch (err) { setError(errorText(err)); }
  }
  return <section className="deliveries-panel" role="region" aria-label={'Passagens de trabalho de ' + (agent || 'agente não informado')}>
    <div className="inbox-heading"><div><span className="eyebrow"><Send size={15}/>PASSAGEM ESTRUTURADA</span><h2>Passagens de trabalho</h2></div>{agent && <span className="count-badge">{items.filter(item => !item.acknowledgedAt).length} {items.filter(item => !item.acknowledgedAt).length === 1 ? 'nova' : 'novas'}</span>}</div>
    {!agent ? <p className="subtle-text">Informe seu nome de agente na barra lateral para ver passagens destinadas a você.</p> :
      loading ? <p className="subtle-text">Consultando passagens…</p> :
      items.length === 0 ? <p className="subtle-text">Nenhuma passagem destinada a {agent}.</p> :
      <div className="delivery-list">{items.map(item => <DeliveryCard key={item.id} delivery={item} onAcknowledge={acknowledge}/>)}</div>}
    {error && <div className="alert" role="alert">{error}</div>}
  </section>;
}

function AgentResume({ projectId, agent, tasks, onExport, onUnreadCountChange }: { projectId: string; agent: string; tasks: Task[]; onExport: () => void; onUnreadCountChange: (count: number) => void }) {
  const [brief, setBrief] = useState<ResumeBrief | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmedTaskId, setConfirmedTaskId] = useState('');
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const resumeRequest = useRef<{ sequence: number; controller: AbortController } | null>(null);
  useEffect(() => {
    resumeRequest.current?.controller.abort();
    setBrief(null);
    setConfirmedTaskId('');
    setPendingTaskId(null);
    setCopied(false);
    setError('');
    if (!agent) { setLoading(false); return; }
    const controller = new AbortController();
    const sequence = (resumeRequest.current?.sequence ?? 0) + 1;
    resumeRequest.current = { sequence, controller };
    setLoading(true);
    api.resume(projectId, agent, undefined, undefined, controller.signal)
      .then(nextBrief => {
        if (controller.signal.aborted || resumeRequest.current?.sequence !== sequence) return;
        setBrief(nextBrief);
        setConfirmedTaskId(nextBrief.focusTask?.id ?? '');
      }).catch(err => { if (!controller.signal.aborted) setError(errorText(err)); })
      .finally(() => { if (!controller.signal.aborted && resumeRequest.current?.sequence === sequence) setLoading(false); });
    return () => controller.abort();
  }, [projectId, agent]);
  async function chooseFocus(taskId: string) {
    if (taskId === confirmedTaskId && pendingTaskId === null) return;
    resumeRequest.current?.controller.abort();
    const controller = new AbortController();
    const sequence = (resumeRequest.current?.sequence ?? 0) + 1;
    resumeRequest.current = { sequence, controller };
    setPendingTaskId(taskId);
    setCopied(false);
    setLoading(true);
    setError('');
    try {
      const nextBrief = await api.resume(projectId, agent, taskId || undefined, taskId ? undefined : 'project', controller.signal);
      if (controller.signal.aborted || resumeRequest.current?.sequence !== sequence) return;
      setBrief(nextBrief);
      setConfirmedTaskId(taskId);
    } catch (err) {
      if (!controller.signal.aborted && resumeRequest.current?.sequence === sequence) setError(errorText(err));
    } finally {
      if (!controller.signal.aborted && resumeRequest.current?.sequence === sequence) {
        setPendingTaskId(null);
        setLoading(false);
      }
    }
  }
  async function copyBrief() {
    if (!brief) return;
    try { await navigator.clipboard.writeText(brief.markdown); setCopied(true); }
    catch { setError('A cópia automática não está disponível. Use a exportação para acessar o contexto.'); }
  }
  async function acknowledgeDelivery(item: HandoffDelivery) {
    const currentBrief = brief;
    if (!currentBrief) return;
    try {
      const receipt = await request<{ acknowledgedAt: string }>('/projects/' + projectId + '/deliveries/' + item.id + '/ack', { agent });
      setBrief(current => current ? {
        ...current,
        deliveries: current.deliveries.map(value => value.id === item.id ? { ...value, acknowledgedAt: receipt.acknowledgedAt } : value),
        attention: current.attention.filter(entry => entry.sourceId !== item.id),
      } : current);
      onUnreadCountChange(Math.max(0, currentBrief.deliveries.filter(value => !value.acknowledgedAt).length - 1));
    } catch (err) { setError(errorText(err)); }
  }
  if (!agent) return <section className="panel resume-empty" role="region" aria-label="Retomada inteligente"><MailOpen size={25}/><h2>Identifique o agente que vai assumir</h2><p>Informe o nome na barra lateral. O AXON montará uma retomada usando a caixa postal e o estado real do projeto.</p></section>;
  const now = Date.now();
  const live = (task: Task) => Boolean(task.leaseUntil && new Date(task.leaseUntil).getTime() > now);
  const claimedByAgent = tasks.filter(task => live(task) && task.assignee === agent);
  const available = tasks.filter(task => !live(task));
  const claimedByOthers = tasks.filter(task => live(task) && task.assignee !== agent);
  const effectiveTaskId = pendingTaskId ?? confirmedTaskId;
  const focusedTask = brief?.focusTask ?? tasks.find(task => task.id === effectiveTaskId) ?? null;
  const taskCheckpoint = brief?.latestTaskCheckpoint ?? null;
  const projectCheckpoint = brief?.latestProjectCheckpoint ?? brief?.latestCheckpoint ?? null;
  const showProjectContext = Boolean(focusedTask && projectCheckpoint && projectCheckpoint.id !== taskCheckpoint?.id);
  const focusStatus = focusedTask
    ? live(focusedTask)
    ? focusedTask.assignee === agent
        ? `Reserva válida para ${agent} até ${new Date(focusedTask.leaseUntil!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`
        : `Reservada por ${focusedTask.assignee} até ${new Date(focusedTask.leaseUntil!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`
      : 'Disponível para assumir.'
    : tasks.length
      ? 'Escolha uma tarefa para montar um briefing específico.'
      : 'Crie uma tarefa quando houver um próximo trabalho definido.';
  return <section className="smart-resume" role="region" aria-label={'Retomada inteligente de ' + agent}>
    <header className="smart-resume-header"><div><span className="eyebrow"><MailOpen size={15}/>CORREIO DE CONTINUIDADE</span><h2>Retomada de {agent}</h2><p>Escolha o trabalho que será retomado e receba somente o contexto correspondente.</p></div><div className="resume-controls">{brief && <span className="resume-revision">versão {brief.revision}</span>}<label className="resume-task-picker" htmlFor="resume-task-focus"><span>Tarefa em foco</span><select id="resume-task-focus" value={effectiveTaskId} disabled={loading} onChange={event => void chooseFocus(event.target.value)}><option value="">Visão geral do projeto</option>{claimedByAgent.length > 0 && <optgroup label="Reservadas por você">{claimedByAgent.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</optgroup>}{available.length > 0 && <optgroup label="Disponíveis">{available.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</optgroup>}{claimedByOthers.length > 0 && <optgroup label="Reservadas por outro agente">{claimedByOthers.map(task => <option key={task.id} value={task.id}>{task.title} · {task.assignee}</option>)}</optgroup>}</select></label><small>{focusStatus} Selecionar organiza o briefing; não inicia trabalho.</small></div></header>
    {loading && <div className="loading" role="status"><RefreshCw size={17}/>Montando sua retomada…</div>}
    {error && <div className="alert" role="alert">{error}</div>}
    {brief && !loading && <><div className="resume-intelligence-grid">
      <article className="resume-focus"><span className="eyebrow">{focusedTask ? 'TAREFA EM FOCO' : 'VISÃO GERAL'}</span><h3>{focusedTask?.title ?? (tasks.length ? 'Escolha a tarefa que será retomada' : 'Nenhuma tarefa registrada')}</h3><div className="resume-next"><span>{focusedTask ? 'PRÓXIMO PASSO DESTA TAREFA' : 'PRÓXIMO PASSO GERAL'}</span><p>{focusedTask ? taskCheckpoint?.nextStep ?? 'Nenhum checkpoint ligado a esta tarefa.' : projectCheckpoint?.nextStep ?? 'Ainda não há próximo passo registrado.'}</p></div>{showProjectContext && projectCheckpoint && <div className="resume-project-context"><div><span>Contexto geral do projeto</span><small>versão {projectCheckpoint.revision} · <DateLabel value={projectCheckpoint.createdAt}/></small></div><p>{projectCheckpoint.summary}</p></div>}<small>{focusStatus} {focusedTask && 'Esta escolha não altera a reserva da tarefa.'}</small></article>
      <article className={brief.attention.length ? 'resume-attention has-items' : 'resume-attention'}><span className="eyebrow"><AlertTriangle size={14}/>ATENÇÃO</span><h3>{brief.attention.length} {brief.attention.length === 1 ? 'item pede atenção' : 'itens pedem atenção'}</h3>{brief.attention.length ? <ul>{brief.attention.slice(0, 5).map((item, index) => <li key={item.sourceId + index}><span>{item.kind === 'blocker' ? 'Bloqueio' : item.kind === 'question' ? 'Pergunta' : item.kind === 'review' ? 'Revisão' : 'Passagem'}</span>{item.text}</li>)}</ul> : <p>Nenhum bloqueio, pergunta, revisão ou passagem pendente.</p>}</article>
    </div>
    {brief.workDraft && <article className="resume-draft"><span className="eyebrow"><NotebookPen size={14}/>RASCUNHO NÃO ENTREGUE</span><h3>{brief.workDraft.nextAction}</h3><p>{brief.workDraft.summary}</p><small>Relatado por {brief.workDraft.actorId} · <DateLabel value={brief.workDraft.updatedAt}/>. Este rascunho não é um checkpoint.</small></article>}
    {brief.deliveries.length > 0 && <div className="resume-deliveries"><div className="panel-heading"><div><h3>Passagens de trabalho</h3><p>Checkpoints entregues a você, com as não lidas primeiro.</p></div><span className="count-badge">{brief.deliveries.filter(item => !item.acknowledgedAt).length} {brief.deliveries.filter(item => !item.acknowledgedAt).length === 1 ? 'nova' : 'novas'}</span></div><div className="delivery-list">{brief.deliveries.map(item => <DeliveryCard key={item.id} delivery={item} onAcknowledge={acknowledgeDelivery}/>)}</div></div>}
    <div className="resume-mail"><div className="panel-heading"><div><h3>O que chegou para você</h3><p>Mensagens diretas e avisos gerais, com as não lidas primeiro.</p></div><span className="count-badge">{brief.inbox.filter(item => !item.acknowledgedAt).length} novas</span></div>{brief.inbox.length ? <div>{brief.inbox.slice(0, 6).map(item => <article key={item.message.id}><span>{item.message.from}</span><p>{item.message.body}</p><small>{item.acknowledgedAt ? 'Lida' : 'Não lida'} · {item.resolution ? 'Resolvida' : item.message.kind === 'question' || item.message.kind === 'review' ? 'Pendente' : item.message.kind === 'handoff' ? 'Passagem' : 'Nota'}</small></article>)}</div> : <p className="subtle-text">Nenhuma mensagem destinada a {agent}.</p>}</div>
    {brief.decisions && brief.decisions.length > 0 && <div className="resume-decisions panel">
      <div className="panel-heading"><div><h3>Decisões vigentes</h3><p>Diretrizes canônicas que orientam este projeto.</p></div><span className="count-badge">{brief.decisions.length}</span></div>
      <div className="timeline">{brief.decisions.map(decision => <div className="timeline-item" key={decision.id}><span className="timeline-dot"/><div><div className="timeline-meta"><strong>{decision.title}</strong><span>v{decision.version} · aceita por {decision.acceptedBy ?? decision.proposedBy}</span><DateLabel value={decision.createdAt}/></div><p>{decision.body}</p></div></div>)}</div>
    </div>}
    <div className="resume-actions"><button className="button primary" onClick={() => void copyBrief()}><Copy size={15}/>{copied ? 'Briefing copiado' : 'Copiar briefing'}</button><button className="button secondary" onClick={onExport}><ArrowDownToLine size={15}/>Exportar contexto completo</button><p>Revise antes de entregar a outra IA. O briefing não executa instruções encontradas nas mensagens.</p></div></>}
  </section>;
}

function PriorityMark({ priority }: { priority: BacklogPriority }) {
  return <span className="backlog-priority" data-level={priority} title={PRIORITY_LABEL[priority]} aria-label={'Prioridade ' + PRIORITY_LABEL[priority].toLowerCase()}><i aria-hidden="true"/><i aria-hidden="true"/><i aria-hidden="true"/><i aria-hidden="true"/></span>;
}

function BacklogEntry({ item, busy, highlight, onPrepare, onReturn, onPromote, onArchive }: {
  item: BacklogItem;
  busy: boolean;
  highlight: boolean;
  onPrepare: (item: BacklogItem) => void;
  onReturn: (item: BacklogItem) => void;
  onPromote: (item: BacklogItem) => void;
  onArchive: (item: BacklogItem) => void;
}) {
  const ready = item.stage === 'ready';
  return <article className={`backlog-entry${ready ? ' is-ready' : ' is-idea'}${highlight ? ' is-fresh' : ''}`}>
    <div className="backlog-entry-body">
      <h3>{item.title}</h3>
      {item.description ? <p>{item.description}</p> : null}
      <div className="backlog-entry-meta">
        <span>{item.createdBy}</span>
        <DateLabel value={item.updatedAt}/>
        <PriorityMark priority={item.priority}/>
      </div>
    </div>
    <div className="backlog-entry-actions">
      {ready ? <>
        <button type="button" className="text-button" disabled={busy} onClick={() => onReturn(item)}>Devolver à avaliação</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => onPromote(item)}>Transformar em tarefa<ArrowRight size={13}/></button>
      </> : <button type="button" className="button secondary" disabled={busy} onClick={() => onPrepare(item)}>Preparar ideia</button>}
      <button type="button" className="text-button backlog-archive" disabled={busy} onClick={() => onArchive(item)} aria-label={'Arquivar ' + item.title}><Archive size={13}/>Arquivar</button>
    </div>
  </article>;
}

function BacklogPanel({ projectId, agent, items, loading, error: loadError, onReload, refresh }: {
  projectId: string;
  agent: string;
  items: BacklogItem[];
  loading: boolean;
  error: string;
  onReload: () => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const notify = useFeedback();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<BacklogPriority>('medium');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [highlightId, setHighlightId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [archivedItems, setArchivedItems] = useState<BacklogItem[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BacklogItem | null>(null);
  const readyItems = items.filter(item => item.stage === 'ready');
  const ideaItems = items.filter(item => item.stage === 'idea');
  const visibleError = error || loadError;

  useEffect(() => {
    if (!showArchived) return;
    const controller = new AbortController();
    setArchivedLoading(true);
    api.backlog(projectId, controller.signal, true)
      .then(list => {
        if (controller.signal.aborted) return;
        setArchivedItems(list.filter(item => item.stage === 'archived'));
      })
      .catch(err => { if (!controller.signal.aborted) setError(errorText(err)); })
      .finally(() => { if (!controller.signal.aborted) setArchivedLoading(false); });
    return () => controller.abort();
  }, [showArchived, projectId, items]);

  async function runMutation(action: () => Promise<string>, success: { message: string; detail: string }, after?: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      const id = await action();
      notify(success.message, success.detail);
      if (id) setHighlightId(id);
      await onReload();
      if (after) await after();
    } catch (err) {
      setError(errorText(err));
      if (isConflict(err)) await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function capture(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!agent) { setError('Preencha o nome do agente na barra lateral.'); return; }
    const nextTitle = title.trim();
    if (!nextTitle) return;
    await runMutation(async () => {
      const created = await api.createBacklogItem(projectId, {
        title: nextTitle,
        createdBy: agent,
        description: description.trim() || undefined,
        priority,
      });
      setTitle('');
      setDescription('');
      titleRef.current?.focus();
      return created.id;
    }, { message: 'Ideia capturada', detail: nextTitle });
  }

  function prepare(item: BacklogItem) {
    void runMutation(
      async () => (await api.updateBacklogItem(projectId, item.id, { expectedVersion: item.version, stage: 'ready' })).id,
      { message: 'Ideia preparada', detail: item.title },
    );
  }
  function returnToIdeas(item: BacklogItem) {
    void runMutation(
      async () => (await api.updateBacklogItem(projectId, item.id, { expectedVersion: item.version, stage: 'idea' })).id,
      { message: 'Ideia devolvida à avaliação', detail: item.title },
    );
  }
  function promote(item: BacklogItem) {
    void runMutation(async () => {
      await api.promoteBacklogItem(projectId, item.id);
      return '';
    }, { message: 'Tarefa criada', detail: item.title }, refresh);
  }
  function archive(item: BacklogItem) {
    void runMutation(async () => {
      await api.archiveBacklogItem(projectId, item.id, { expectedVersion: item.version });
      return '';
    }, { message: 'Ideia arquivada', detail: item.title });
  }
  async function deleteArchived(item: BacklogItem) {
    setError('');
    setBusy(true);
    try {
      await api.deleteBacklogItem(projectId, item.id, item.version);
      notify('Ideia excluída', item.title);
      setPendingDelete(null);
      setArchivedItems(current => current.filter(entry => entry.id !== item.id));
      await onReload();
    } catch (err) {
      setError(errorText(err));
      if (isConflict(err)) {
        setPendingDelete(null);
        await onReload();
      }
    } finally {
      setBusy(false);
    }
  }

  const entryProps = { busy, onPrepare: prepare, onReturn: returnToIdeas, onPromote: promote, onArchive: archive };

  return <section className="backlog-desk" aria-busy={loading}>
    <div className="section-heading">
      <div>
        <h2>Backlog</h2>
        <p>Capture a ideia antes de virar tarefa.</p>
      </div>
      <button type="button" className="button secondary" aria-pressed={showArchived} onClick={() => setShowArchived(open => !open)}>Mostrar arquivadas</button>
    </div>
    <form className="backlog-composer" onSubmit={event => void capture(event)}>
      <div className="backlog-field backlog-field-title">
        <label htmlFor="backlog-title">Título da ideia</label>
        <input ref={titleRef} id="backlog-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required placeholder="O que precisa ser registrado?"/>
      </div>
      <div className="backlog-field backlog-field-priority">
        <label htmlFor="backlog-priority">Prioridade</label>
        <select id="backlog-priority" value={priority} onChange={event => setPriority(event.target.value as BacklogPriority)}>
          <option value="urgent">Urgente</option>
          <option value="high">Alta</option>
          <option value="medium">Média</option>
          <option value="low">Baixa</option>
        </select>
      </div>
      <button type="submit" className="button primary" disabled={busy || !title.trim()}>Capturar ideia</button>
      <div className="backlog-field backlog-field-notes">
        <label htmlFor="backlog-description">Descrição (opcional)</label>
        <textarea id="backlog-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={6000} rows={2} placeholder="Contexto curto, se já existir."/>
      </div>
    </form>
    {loading && items.length === 0 && <div className="backlog-loading" role="status"><RefreshCw size={15}/>Consultando backlog…</div>}
    {visibleError && <div className="alert" role="alert"><span>{visibleError}</span><button type="button" onClick={() => { setError(''); void onReload(); }}>Tentar novamente</button></div>}
    <section className="backlog-rail is-ready" role="region" aria-label="Prontos para virar tarefa">
        <header className="backlog-rail-head">
          <h3>Prontos para virar tarefa</h3>
          <span className="backlog-rail-count">{readyItems.length}</span>
        </header>
        {readyItems.length === 0
          ? <p className="backlog-empty">Nenhuma ideia pronta ainda.</p>
          : <div className="backlog-ledger">{readyItems.map(item => <BacklogEntry key={item.id} item={item} highlight={item.id === highlightId} {...entryProps}/>)}</div>}
      </section>
      <section className="backlog-rail is-idea" role="region" aria-label="Ideias em avaliação">
        <header className="backlog-rail-head">
          <h3>Ideias em avaliação</h3>
          <span className="backlog-rail-count">{ideaItems.length}</span>
        </header>
        {ideaItems.length === 0
          ? <p className="backlog-empty">Nenhuma ideia em avaliação.</p>
          : <div className="backlog-ledger">{ideaItems.map(item => <BacklogEntry key={item.id} item={item} highlight={item.id === highlightId} {...entryProps}/>)}</div>}
      </section>
      {showArchived && <section className="backlog-rail is-archived" role="region" aria-label="Ideias arquivadas">
        <header className="backlog-rail-head">
          <h3>Arquivadas</h3>
          <span className="backlog-rail-count">{archivedItems.length}</span>
        </header>
        {archivedLoading && archivedItems.length === 0
          ? <p className="backlog-empty">Consultando arquivadas…</p>
          : archivedItems.length === 0
            ? <p className="backlog-empty">Nenhuma ideia arquivada.</p>
            : <div className="backlog-ledger">{archivedItems.map(item => <article key={item.id} className="backlog-entry is-archived">
                <div className="backlog-entry-body">
                  <h3>{item.title}</h3>
                  {item.description ? <p>{item.description}</p> : null}
                  <div className="backlog-entry-meta">
                    <span>{item.createdBy}</span>
                    <DateLabel value={item.updatedAt}/>
                    <PriorityMark priority={item.priority}/>
                  </div>
                </div>
                <div className="backlog-entry-actions">
                  <button type="button" className="text-button backlog-delete" disabled={busy} onClick={() => setPendingDelete(item)}>Excluir permanentemente</button>
                </div>
              </article>)}</div>}
      </section>}
      {pendingDelete && <DeleteBacklogItemDialog item={pendingDelete} busy={busy} error={error} onClose={() => { if (!busy) { setPendingDelete(null); setError(''); } }} onConfirm={() => void deleteArchived(pendingDelete)}/>}
  </section>;
}

function DecisionsPanel({
  projectId,
  agent,
  decisions,
  loading,
  error,
  showHistory,
  onToggleHistory,
  onPropose,
  onAccept,
  onRevoke,
  onSupersede,
  onReload,
}: {
  projectId: string;
  agent: string;
  decisions: Decision[];
  loading: boolean;
  error: string;
  showHistory: boolean;
  onToggleHistory: () => void;
  onPropose: () => void;
  onAccept: (decision: Decision) => void;
  onRevoke: (decision: Decision) => void;
  onSupersede: (decision: Decision) => void;
  onReload: () => Promise<void>;
}) {
  const [selectedTimelineDecision, setSelectedTimelineDecision] = useState<Decision | null>(null);
  return (
    <section className="decisions-panel" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <h2>Decisões canônicas</h2>
          <p>Diretrizes e escolhas arquiteturais. Decisões vigentes orientam as IAs nos briefings de continuidade.</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="button secondary"
            aria-pressed={showHistory}
            onClick={onToggleHistory}
          >
            {showHistory ? 'Mostrar apenas vigentes' : 'Mostrar histórico completo'}
          </button>
          <button type="button" className="button primary" onClick={onPropose}>
            <Plus size={16} />
            Propor decisão
          </button>
        </div>
      </div>

      {loading && decisions.length === 0 && (
        <div className="loading" role="status">
          <RefreshCw size={17} />
          Consultando decisões…
        </div>
      )}

      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void onReload()}>Tentar novamente</button>
        </div>
      )}

      {!loading && decisions.length === 0 ? (
        <EmptyNote>
          <Flag size={25} />
          <p>
            {showHistory
              ? 'Nenhuma decisão registrada neste projeto.'
              : 'Nenhuma decisão vigente no momento.'}
            <br />
            <span>Uma decisão proposta por IA só tem valor canônico após ser aceita pelo operador humano.</span>
          </p>
          <button type="button" className="text-button" onClick={onPropose}>
            Propor primeira decisão
            <ArrowRight size={14} />
          </button>
        </EmptyNote>
      ) : (
        <div className="decision-list">
          {decisions.map(decision => {
            const isProposed = decision.status === 'proposed';
            const isAccepted = decision.status === 'accepted';
            const isSuperseded = decision.status === 'superseded';
            const isRevoked = decision.status === 'revoked';

            const statusLabel =
              isAccepted ? 'Vigente' :
              isProposed ? 'Proposta' :
              isSuperseded ? 'Substituída' :
              'Revogada';

            const statusClass =
              isAccepted ? 'decision-tag-accepted' :
              isProposed ? 'decision-tag-proposed' :
              isSuperseded ? 'decision-tag-superseded' :
              'decision-tag-revoked';

            return (
              <article
                key={decision.id}
                className={`decision-card ${isSuperseded ? 'is-superseded' : ''} ${isRevoked ? 'is-revoked' : ''}`}
              >
                <div className="decision-card-head">
                  <span className={`status-tag ${statusClass}`}>{statusLabel}</span>
                  <span className="revision-badge">v{decision.version}</span>
                  {decision.source?.kind === 'human_directive' && (
                    <span className="status-tag neutral">Diretiva humana</span>
                  )}
                  <DateLabel value={decision.createdAt} />
                </div>
                <h3>{decision.title}</h3>
                <p className="decision-card-body">{decision.body}</p>
                <div className="decision-card-meta">
                  <span>Proposta por <strong>{decision.proposedBy}</strong></span>
                  {decision.acceptedBy && <span> · Aceita por <strong>{decision.acceptedBy}</strong></span>}
                  {decision.revokedBy && <span> · Revogada por <strong>{decision.revokedBy}</strong></span>}
                  {decision.supersedesId && <span> · Substitui decisão anterior</span>}
                  {decision.supersededById && <span> · Substituída por nova versão</span>}
                  {decision.source?.note && <small className="decision-note">({decision.source.note})</small>}
                </div>
                <div className="decision-card-actions">
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => setSelectedTimelineDecision(decision)}
                  >
                    Linha do tempo
                  </button>
                  {isProposed && (
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => onAccept(decision)}
                    >
                      <Check size={14} />
                      Aceitar decisão
                    </button>
                  )}
                  {isAccepted && (
                    <>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => onSupersede(decision)}
                      >
                        Substituir
                      </button>
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => onRevoke(decision)}
                      >
                        Revogar
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {selectedTimelineDecision && (
        <DecisionTimelineDialog
          projectId={projectId}
          decision={selectedTimelineDecision}
          onClose={() => setSelectedTimelineDecision(null)}
        />
      )}
    </section>
  );
}

function CharterPanel({ projectId, agent, refresh }: { projectId: string; agent: string; refresh: () => Promise<void> }) {
  const notify = useFeedback();
  const [charter, setCharter] = useState<CharterRevision | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => {
    api.charter(projectId).then(item => {
      setCharter(item);
      setBody(item?.body ?? '');
    }).catch(err => setError(errorText(err)));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!agent) { setError('Informe o nome do agente na barra lateral.'); return; }
    setBusy(true); setError('');
    try {
      const next = await api.saveCharter(projectId, { actor: agent, body, expectedRevision: charter?.revision ?? 0 });
      notify('Diretriz do projeto atualizada', `Versão ${next.revision}`);
      setCharter(next);
      setEditing(false);
      await refresh();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <section className="panel" aria-label="Diretriz do projeto">
    <div className="panel-heading"><h2>Diretriz do projeto</h2><span className="mono-label">{charter ? `VERSÃO ${charter.revision}` : 'AUSENTE'}</span></div>
    <p className="subtle-text">Diretriz humana vigente. Uma IA pode propor texto, mas a versão fica registrada.</p>
    {error && <div className="alert" role="alert">{error}</div>}
    {!editing ? (
      <div className="charter-collapsed-view">
        {charter?.body ? <p className="charter-preview-body">{charter.body}</p> : <p className="subtle-text">Nenhuma diretriz definida ainda.</p>}
        <button type="button" className="button secondary" onClick={() => setEditing(true)}>Editar diretriz</button>
      </div>
    ) : (
      <form className="form-stack" onSubmit={event => void save(event)}>
        <label>Texto vigente da diretriz do projeto<textarea aria-label="Texto vigente da diretriz do projeto" value={body} onChange={event => setBody(event.target.value)} required maxLength={8000} rows={3} disabled={busy}/></label>
        <div className="form-row-actions">
          <button className="button secondary" disabled={busy || !body.trim() || !agent || body === (charter?.body ?? '')}>Salvar versão</button>
          <button type="button" className="button ghost" onClick={() => { setEditing(false); setBody(charter?.body ?? ''); }}>Cancelar</button>
        </div>
      </form>
    )}
  </section>;
}

function BlockersPanel({ projectId, agent, refresh }: { projectId: string; agent: string; refresh: () => Promise<void> }) {
  const notify = useFeedback();
  const [items, setItems] = useState<ProjectBlocker[]>([]);
  const [selectedTimelineBlocker, setSelectedTimelineBlocker] = useState<ProjectBlocker | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const load = useCallback(() => {
    api.blockers(projectId, true).then(setItems).catch(err => setError(errorText(err)));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  const openItems = items.filter(item => item.status === 'open' || item.status === 'mitigated');
  async function open(event: FormEvent) {
    event.preventDefault();
    if (!agent) { setError('Informe o nome do agente na barra lateral.'); return; }
    setBusy(true); setError('');
    try {
      await api.openBlocker(projectId, { agent, title, body });
      notify('Bloqueio aberto', title);
      setTitle(''); setBody('');
      setFormOpen(false);
      load();
      await refresh();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function resolve(item: ProjectBlocker) {
    if (!agent) { setError('Informe o nome do agente na barra lateral.'); return; }
    setBusy(true); setError('');
    try {
      await api.resolveBlocker(projectId, item.id, { agent, expectedVersion: item.version, note: 'Resolvido na interface.' });
      notify('Bloqueio resolvido', item.title);
      load();
      await refresh();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <section className="panel" aria-label="Bloqueios abertos">
    <div className="panel-heading"><h2>Bloqueios</h2><span className="mono-label">NÃO SOMEM SÓ DE LER</span></div>
    {error && <div className="alert" role="alert">{error}</div>}
    {openItems.length === 0 ? <p className="subtle-text">Nenhum bloqueio aberto.</p> : openItems.map(item => (
      <article key={item.id} className="decision-entry">
        <strong>{item.title}</strong>
        <p>{item.body}</p>
        <div className="decision-entry-actions">
          <span>{item.status === 'mitigated' ? 'Mitigado' : 'Aberto'} · {item.openedBy}</span>
          <button type="button" className="text-button" onClick={() => setSelectedTimelineBlocker(item)}>Histórico</button>
          <button type="button" className="text-button" disabled={busy || !agent} onClick={() => void resolve(item)}>Resolver</button>
        </div>
      </article>
    ))}
    {!formOpen ? (
      <button type="button" className="button secondary" onClick={() => setFormOpen(true)}>Abrir bloqueio</button>
    ) : (
      <form className="form-stack" onSubmit={event => void open(event)}>
        <label>Título do bloqueio<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={200} disabled={busy}/></label>
        <label>O que impede o trabalho<textarea aria-label="O que impede o trabalho" value={body} onChange={event => setBody(event.target.value)} required maxLength={8000} rows={2} disabled={busy}/></label>
        <div className="form-row-actions">
          <button className="button secondary" disabled={busy || !title.trim() || !body.trim() || !agent}>Salvar bloqueio</button>
          <button type="button" className="button ghost" onClick={() => { setFormOpen(false); setTitle(''); setBody(''); }}>Cancelar</button>
        </div>
      </form>
    )}
    {selectedTimelineBlocker && (
      <BlockerTimelineDialog
        projectId={projectId}
        blocker={selectedTimelineBlocker}
        onClose={() => setSelectedTimelineBlocker(null)}
      />
    )}
  </section>;
}
