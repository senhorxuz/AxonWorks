import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckSquare, Copy, Download, ExternalLink, FileCode, Laptop, Plug, Plus, RefreshCw, Send, SlidersHorizontal, Square, Terminal, Trash2 } from 'lucide-react';
import type { BacklogItem, Project, ProjectDetail, Checkpoint, CheckpointInput, ConnectorsInfo, Handoff, MessageInput, Task, AcceptanceCriterion, ExpectedOutput, ExpectedOutputKind, TaskPriority, EvidenceView, BlockerTimeline, DecisionTimeline } from '../shared/types';
import type { Decision, FinalizeWorkInput, ImportProjectResult, InboxItem, MessageResolution, SaveWorkDraftInput, WorkDraft, ProjectBlocker } from '../shared/continuity';
import { api, request, errorText, ApiError } from './api';
import { Modal, DateLabel } from './ui';
import { useFeedback } from './Feedback';

export function NewProject({ onClose, onCreated }: { onClose: () => void; onCreated: (project: Project) => void }) {
  const [name, setName] = useState(''); const [objective, setObjective] = useState(''); const [workspacePath, setPath] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { onCreated(await request<Project>('/projects', { name, objective, workspacePath })); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } }
  return <Modal title="Novo projeto" eyebrow="WORKSPACE" onClose={onClose}><p className="modal-description">Informe um nome e o que você quer fazer.</p><form onSubmit={submit} className="form-stack"><label>Nome do projeto<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Meu novo aplicativo" required maxLength={160}/></label><label>Objetivo<textarea aria-label="Objetivo" value={objective} onChange={e => setObjective(e.target.value)} placeholder="O que você quer construir ou resolver?" required maxLength={8000} rows={3}/></label><label>Pasta do projeto (opcional)<input value={workspacePath} onChange={e => setPath(e.target.value)} placeholder="D:\projetos\meu-projeto" maxLength={2000}/><small>Uma referência local. Nenhum arquivo será importado ou alterado.</small></label>{error && <div className="alert" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || !name.trim() || !objective.trim()}>{busy ? 'Criando…' : 'Criar projeto'}<ArrowRight size={16}/></button></div></form></Modal>;
}

export function CheckpointDialog({ detail, agent, onClose, onSaved, refresh }: { detail: ProjectDetail; agent: string; onClose: () => void; onSaved: () => Promise<void>; refresh: () => Promise<void> }) {
  const notify = useFeedback();
  const [summary, setSummary] = useState(''); const [nextStep, setNextStep] = useState(''); const [taskId, setTaskId] = useState('');
  const [decisions, setDecisions] = useState(''); const [blockers, setBlockers] = useState('');
  const [command, setCommand] = useState(''); const [outcome, setOutcome] = useState<'passed' | 'failed' | 'not_run'>('not_run'); const [details, setDetails] = useState('');
  const [revision, setRevision] = useState(detail.project.revision); const [error, setError] = useState(''); const [conflict, setConflict] = useState(false); const [remoteNotice, setRemoteNotice] = useState(''); const [busy, setBusy] = useState(false);
  const lastAttempt = useRef<{ serialized: string; payload: CheckpointInput } | null>(null);
  const lines = (text: string) => text.split('\n').map(x => x.trim()).filter(Boolean);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!agent) { setError('Informe o nome do agente na barra lateral antes de salvar.'); return; }
    setError(''); setBusy(true);
    const input = { agent, expectedRevision: revision, ...(taskId ? { taskId } : {}), summary, nextStep, decisions: lines(decisions), blockers: lines(blockers), evidence: command.trim() ? [{ command, outcome, details }] : [] };
    const serialized = JSON.stringify(input);
    if (lastAttempt.current?.serialized !== serialized) lastAttempt.current = { serialized, payload: { ...input, idempotencyKey: crypto.randomUUID() } };
    try { await request(`/projects/${detail.project.id}/checkpoints`, lastAttempt.current.payload); notify('Checkpoint salvo','O próximo passo ficou registrado.'); await onSaved(); }
    catch (err) { setError(errorText(err)); setConflict(err instanceof ApiError && err.status === 409); }
    finally { setBusy(false); }
  }
  async function reloadRevision() {
    setBusy(true); try { const current = await api.project(detail.project.id); setRevision(current.project.revision); const last = [...current.checkpoints].sort((a, b) => b.revision - a.revision)[0]; setRemoteNotice(`Versão ${current.project.revision} carregada. Próximo passo atual: ${last?.nextStep ?? 'não registrado'}. Confira seu texto antes de salvar novamente.`); setConflict(false); setError(''); lastAttempt.current = null; await refresh(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  const eligibleTasks = detail.tasks.filter(t => t.assignee === agent && t.leaseUntil && new Date(t.leaseUntil).getTime() > Date.now());
  return <Modal title="Salvar checkpoint" eyebrow={`CHECKPOINT · A PARTIR DA VERSÃO ${revision}`} onClose={onClose} wide><p className="modal-description">Salvo como <strong>{agent || 'agente não informado'}</strong>. O checkpoint permanece no histórico.</p><form onSubmit={submit} className="form-stack"><label>Resumo do progresso<textarea aria-label="Resumo do progresso" autoFocus value={summary} onChange={e => setSummary(e.target.value)} placeholder="O que foi feito e em que estado o trabalho está?" required maxLength={8000} rows={3}/></label><label>Próximo passo<textarea aria-label="Próximo passo" value={nextStep} onChange={e => setNextStep(e.target.value)} placeholder="Uma ação concreta para a próxima IA começar." required maxLength={6000} rows={2}/></label><label>Tarefa relacionada<select value={taskId} onChange={e => setTaskId(e.target.value)}><option value="">Nota geral do projeto</option>{eligibleTasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select><small>Para vincular uma tarefa, ela precisa estar assumida por você.</small></label><div className="form-columns"><label>Decisões<textarea aria-label="Decisões" value={decisions} onChange={e => setDecisions(e.target.value)} placeholder="Uma decisão por linha" rows={2} maxLength={12000}/></label><label>Bloqueios e incertezas<textarea aria-label="Bloqueios e incertezas" value={blockers} onChange={e => setBlockers(e.target.value)} placeholder="Um ponto por linha" rows={2} maxLength={12000}/></label></div><details className="evidence-disclosure"><summary>Adicionar evidência de teste <span>opcional</span></summary><div className="form-stack"><p>Este checkpoint será marcado como <strong>informado pela IA</strong>.</p><label>Comando do teste<input value={command} onChange={e => setCommand(e.target.value)} placeholder="Ex.: npm test" maxLength={2000}/></label><label>Resultado informado<select value={outcome} onChange={e => setOutcome(e.target.value as typeof outcome)}><option value="not_run">Não executado</option><option value="passed">Sucesso informado</option><option value="failed">Falha informada</option></select></label><label>Detalhes da evidência<textarea aria-label="Detalhes da evidência" value={details} onChange={e => setDetails(e.target.value)} placeholder="Resultado, limitações e referência ao log" maxLength={8000} rows={2}/></label></div></details>{error && <div className="alert" role="alert">{error}{conflict && <button type="button" disabled={busy} onClick={() => void reloadRevision()}>Carregar versão atual</button>}</div>}{remoteNotice && <div className="notice" role="status">{remoteNotice}</div>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || conflict || !summary.trim() || !nextStep.trim() || !agent}>{busy ? 'Salvando…' : 'Salvar checkpoint'}<Check size={16}/></button></div></form></Modal>;
}

export function FinalizeWorkDialog({ detail, agent, drafts, onClose, onSaved, refresh }: { detail: ProjectDetail; agent: string; drafts: WorkDraft[]; onClose: () => void; onSaved: () => Promise<void>; refresh: () => Promise<void> }) {
  const notify = useFeedback();
  const [summary, setSummary] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [taskId, setTaskId] = useState('');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [outcome, setOutcome] = useState<'keep' | 'release' | 'blocked' | 'done'>('release');
  const [blockedReason, setBlockedReason] = useState('');
  const [retainLease, setRetainLease] = useState(false);
  const [discardDraft, setDiscardDraft] = useState(false);
  const [revision, setRevision] = useState(detail.project.revision);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastAttempt = useRef<{ serialized: string; payload: FinalizeWorkInput } | null>(null);
  const eligibleTasks = detail.tasks.filter(t => t.assignee === agent && t.leaseUntil && new Date(t.leaseUntil).getTime() > Date.now());
  const matchingDraft = drafts.find(draft => draft.taskId === (taskId || null));
  useEffect(() => { setDiscardDraft(Boolean(matchingDraft)); }, [matchingDraft?.id]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!agent) { setError('Informe o nome do agente na barra lateral antes de encerrar.'); return; }
    setError('');
    setBusy(true);
    const taskTransition: FinalizeWorkInput['taskTransition'] =
      outcome === 'done' ? { kind: 'declare_done' }
      : outcome === 'blocked' ? { kind: 'declare_blocked', reason: blockedReason, retainLease }
      : outcome === 'release' && taskId ? { kind: 'release' }
      : { kind: 'keep_claimed' };
    const input: Omit<FinalizeWorkInput, 'idempotencyKey'> = {
      agent,
      expectedRevision: revision,
      summary,
      nextStep,
      taskTransition,
      ...(taskId ? { taskId } : {}),
      ...(to.trim() ? { delivery: { to: to.trim(), message } } : {}),
      ...(discardDraft && matchingDraft ? {
        discardDraft: true,
        draftId: matchingDraft.id,
        expectedDraftVersion: matchingDraft.version,
      } : {}),
    };
    const serialized = JSON.stringify(input);
    if (lastAttempt.current?.serialized !== serialized) lastAttempt.current = { serialized, payload: { ...input, idempotencyKey: crypto.randomUUID() } };
    try {
      await api.finalizeWork(detail.project.id, lastAttempt.current.payload);
      notify('Trabalho encerrado', 'O checkpoint foi salvo. Isso não inicia outra IA.');
      await onSaved();
    } catch (err) {
      setError(errorText(err));
      setConflict(err instanceof ApiError && err.status === 409);
    } finally {
      setBusy(false);
    }
  }
  async function reloadRevision() {
    setBusy(true);
    try {
      const current = await api.project(detail.project.id);
      setRevision(current.project.revision);
      setConflict(false);
      setError('');
      lastAttempt.current = null;
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Encerrar trabalho" eyebrow={`SAÍDA · A PARTIR DA VERSÃO ${revision}`} onClose={onClose} wide>
    <p className="modal-description">Salva o checkpoint e aplica a transição que você escolher. Não inicia uma IA. Concluída e bloqueada só voltam com reabertura explícita.</p>
    <form className="form-stack" onSubmit={event => void submit(event)}>
      <label>Resumo do progresso<textarea aria-label="Resumo do progresso" autoFocus value={summary} onChange={event => setSummary(event.target.value)} required maxLength={8000} rows={3} placeholder="O que ficou feito nesta sessão."/></label>
      <label>Próximo passo<textarea aria-label="Próximo passo" value={nextStep} onChange={event => setNextStep(event.target.value)} required maxLength={8000} rows={2} placeholder="O que a próxima IA deve fazer primeiro."/></label>
      <label>Tarefa relacionada<select value={taskId} onChange={event => setTaskId(event.target.value)}><option value="">Nota geral do projeto</option>{eligibleTasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      <label>Destinatário da passagem<input value={to} onChange={event => setTo(event.target.value)} placeholder="Opcional. Ex.: Grok ou *" maxLength={80}/><small>Deixe em branco para encerrar sem passagem.</small></label>
      {to.trim() ? <label>Mensagem para a próxima IA<textarea aria-label="Mensagem para a próxima IA" value={message} onChange={event => setMessage(event.target.value)} rows={3} maxLength={8000}/></label> : null}
      <label>O que acontece com a tarefa<select aria-label="O que acontece com a tarefa" value={outcome} onChange={event => setOutcome(event.target.value as typeof outcome)} disabled={!taskId}>
        <option value="keep">Manter a reserva</option>
        <option value="release">Liberar a tarefa</option>
        <option value="blocked">Declarar bloqueada</option>
        <option value="done">Declarar concluída</option>
      </select></label>
      {outcome === 'blocked' && <>
        <label>Motivo do bloqueio<textarea aria-label="Motivo do bloqueio" value={blockedReason} onChange={event => setBlockedReason(event.target.value)} required maxLength={2000} rows={2} placeholder="O impedimento concreto, para a próxima IA não adivinhar."/></label>
        <label className="check-row"><input type="checkbox" checked={retainLease} onChange={event => setRetainLease(event.target.checked)}/>Manter a reserva enquanto estiver bloqueada</label>
      </>}
      {matchingDraft && <label className="check-row"><input type="checkbox" checked={discardDraft} onChange={event => setDiscardDraft(event.target.checked)}/>Descartar o rascunho não entregue v{matchingDraft.version}</label>}
      {error && <div className="alert" role="alert">{error}{conflict && <button type="button" disabled={busy} onClick={() => void reloadRevision()}>Carregar versão atual</button>}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || conflict || !summary.trim() || !nextStep.trim() || !agent}>{busy ? 'Encerrando…' : 'Encerrar trabalho'}<Check size={16}/></button></div>
    </form>
  </Modal>;
}

export function WorkIntentDialog({ projectId, agent, task, onClose, onSaved }: { projectId: string; agent: string; task: Task; onClose: () => void; onSaved: (overlaps: Array<{ explanation: string }>) => Promise<void> }) {
  const notify = useFeedback();
  const current = task.workIntent;
  const [objective, setObjective] = useState(current?.objective ?? '');
  const [locator, setLocator] = useState(current?.areas[0]?.locator ?? '');
  const [access, setAccess] = useState<'read' | 'write'>(current?.areas[0]?.access ?? 'write');
  const [outputs, setOutputs] = useState((current?.expectedOutputs ?? []).join('\n'));
  const [checks, setChecks] = useState((current?.plannedChecks ?? []).join('\n'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!agent) { setError('Informe o nome do agente na barra lateral.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await request<Task & { overlaps?: Array<{ explanation: string }> }>(`/projects/${projectId}/tasks/${task.id}/claim`, {
        agent,
        expectedVersion: task.version,
        intent: {
          objective,
          areas: locator.trim() ? [{ kind: 'file_path', locator, access }] : [],
          expectedOutputs: outputs.split('\n').map(value => value.trim()).filter(Boolean),
          plannedChecks: checks.split('\n').map(value => value.trim()).filter(Boolean),
        },
      });
      notify(result.overlaps?.length ? 'Intenção gravada com sobreposição' : 'Intenção gravada', 'Não é um lock.');
      await onSaved(result.overlaps ?? []);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Declarar intenção" eyebrow="RESERVA · NÃO É LOCK" onClose={onClose}>
    <p className="modal-description">Diz o que você pretende escrever. Se outra reserva já declarou a mesma área, a Axon avisa e deixa a decisão com vocês.</p>
    <form className="form-stack" onSubmit={event => void submit(event)}>
      <label>Objetivo desta reserva<textarea aria-label="Objetivo desta reserva" autoFocus value={objective} onChange={event => setObjective(event.target.value)} required maxLength={2000} rows={2}/></label>
      <label>Arquivo ou pasta de escrita<input aria-label="Arquivo ou pasta de escrita" value={locator} onChange={event => setLocator(event.target.value)} maxLength={500} placeholder="Ex.: server/store.ts"/></label>
      <label>Acesso<select aria-label="Acesso" value={access} onChange={event => setAccess(event.target.value as 'read' | 'write')}><option value="write">Escrita</option><option value="read">Leitura</option></select></label>
      <label>Saídas esperadas<textarea aria-label="Saídas esperadas" value={outputs} onChange={event => setOutputs(event.target.value)} rows={2} placeholder="Uma por linha"/></label>
      <label>Checagens planejadas<textarea aria-label="Checagens planejadas" value={checks} onChange={event => setChecks(event.target.value)} rows={2} placeholder="Uma por linha"/></label>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || !objective.trim() || !agent}>{busy ? 'Gravando…' : 'Gravar intenção'}<Check size={16}/></button></div>
    </form>
  </Modal>;
}

export function ReopenTaskDialog({ projectId, agent, task, onClose, onSaved }: { projectId: string; agent: string; task: { id: string; title: string; version: number; status: string }; onClose: () => void; onSaved: () => Promise<void> }) {
  const notify = useFeedback();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!agent) { setError('Informe o nome do agente na barra lateral.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.reopenTask(projectId, task.id, { agent, expectedVersion: task.version, note });
      notify('Tarefa reaberta', task.title);
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Reabrir tarefa" eyebrow={task.status === 'done' ? 'CONCLUÍDA' : 'BLOQUEADA'} onClose={onClose}>
    <p className="modal-description">A reabertura fica no histórico. Não apaga o checkpoint de conclusão e não inicia uma IA.</p>
    <form className="form-stack" onSubmit={event => void submit(event)}>
      <p className="subtle-text">{task.title}</p>
      <label>Por que esta tarefa volta ao trabalho?<textarea aria-label="Por que esta tarefa volta ao trabalho?" autoFocus value={note} onChange={event => setNote(event.target.value)} required maxLength={2000} rows={3} placeholder="Ex.: A revisão pediu um ajuste nos detalhes."/></label>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || !note.trim() || !agent}>{busy ? 'Reabrindo…' : 'Reabrir tarefa'}<Check size={16}/></button></div>
    </form>
  </Modal>;
}

export function MessageDialog({ projectId, agent, onClose, onSaved }: { projectId: string; agent: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const notify = useFeedback();
  const [to, setTo] = useState(''); const [kind, setKind] = useState<MessageInput['kind']>('note'); const [body, setBody] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); setBusy(true); try { await request(`/projects/${projectId}/messages`, { from: agent, to, kind, body }); notify('Mensagem registrada','Disponível na caixa postal de '+to+'.'); await onSaved(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } }
  return <Modal title="Nova mensagem" eyebrow="CAIXA POSTAL" onClose={onClose}><p className="modal-description">De <strong>{agent || 'agente não informado'}</strong> para a caixa postal do projeto. O envio não inicia uma IA.</p><form onSubmit={submit} className="form-stack"><div className="form-columns"><label>Destinatário<input autoFocus value={to} onChange={e => setTo(e.target.value)} required placeholder="Ex.: Gemini" maxLength={80}/></label><label>Tipo de mensagem<select value={kind} onChange={e => setKind(e.target.value as MessageInput['kind'])}><option value="note">Nota</option><option value="question">Pergunta</option><option value="review">Pedido de revisão</option><option value="handoff">Passagem de trabalho</option></select></label></div><label>Mensagem<textarea aria-label="Mensagem" value={body} onChange={e => setBody(e.target.value)} required rows={5} placeholder="Compartilhe uma descoberta ou peça uma revisão específica." maxLength={12000}/></label>{error && <div className="alert" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || !body.trim() || !to.trim() || !agent}>{busy ? 'Enviando…' : 'Enviar mensagem'}<Send size={15}/></button></div></form></Modal>;
}

export function ResolveMessageDialog({ projectId, agent, item, onClose, onResolved }: { projectId: string; agent: string; item: InboxItem; onClose: () => void; onResolved: (resolution: MessageResolution) => void }) {
  const notify = useFeedback();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    setError('');
    setBusy(true);
    try {
      const resolution = await api.resolveMessageAttention(projectId, item.message.id, { agent, note });
      notify('Pendência resolvida', 'O desfecho ficou disponível para a próxima IA.');
      onResolved(resolution);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <Modal title="Resolver pendência" eyebrow="DESFECHO REGISTRADO" onClose={onClose}>
    <p className="modal-description">Explique de forma curta o que decidiu, corrigiu ou verificou. Ler confirma o recebimento; resolver registra o desfecho.</p>
    <div className="resolution-source">
      <span>{item.message.kind === 'question' ? 'PERGUNTA DE' : 'REVISÃO PEDIDA POR'} {item.message.from}</span>
      <p>{item.message.body}</p>
    </div>
    <form className="form-stack" onSubmit={event => void submit(event)}>
      <label>Como esta pendência foi resolvida?<textarea autoFocus aria-label="Como esta pendência foi resolvida?" value={note} onChange={event => setNote(event.target.value)} rows={4} maxLength={8000} placeholder="Ex.: Adotamos a decisão e registramos no checkpoint versão 12." required/><small>Deixe informação suficiente para outra IA entender o resultado sem refazer a investigação.</small></label>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || !note.trim()}>{busy ? 'Registrando…' : 'Registrar resolução'}<Check size={16}/></button></div>
    </form>
  </Modal>;
}

export function WorkDraftDialog({ detail, agent, draft, onClose, onSaved }: { detail: ProjectDetail; agent: string; draft: WorkDraft | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const notify = useFeedback();
  const [summary, setSummary] = useState(draft?.summary ?? '');
  const [nextAction, setNextAction] = useState(draft?.nextAction ?? '');
  const [taskId, setTaskId] = useState(draft?.taskId ?? '');
  const [changedAreas, setChangedAreas] = useState((draft?.changedAreas ?? []).join('\n'));
  const [openIssues, setOpenIssues] = useState((draft?.openIssues ?? []).join('\n'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lines = (text: string) => text.split('\n').map(value => value.trim()).filter(Boolean);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!agent) { setError('Informe o nome do agente na barra lateral antes de salvar o rascunho.'); return; }
    setError('');
    setBusy(true);
    const input: SaveWorkDraftInput = {
      agent,
      expectedVersion: draft?.version ?? 0,
      summary,
      nextAction,
      changedAreas: lines(changedAreas),
      openIssues: lines(openIssues),
      ...(taskId ? { taskId } : { taskId: null }),
    };
    try {
      await api.saveWorkDraft(detail.project.id, input);
      notify('Rascunho salvo', 'Continua marcado como não entregue. Não substitui um checkpoint.');
      await onSaved();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <Modal title="Rascunho não entregue" eyebrow="EMERGÊNCIA · NÃO É CHECKPOINT" onClose={onClose} wide>
    <p className="modal-description">Use quando a sessão pode cair. O rascunho não incrementa a versão, não vira passagem e nunca substitui o último checkpoint.</p>
    <form className="form-stack" onSubmit={event => void submit(event)}>
      <label>O que estava sendo feito<textarea aria-label="O que estava sendo feito" autoFocus value={summary} onChange={event => setSummary(event.target.value)} required maxLength={8000} rows={3} placeholder="O estado real do trabalho, ainda sem entrega."/></label>
      <label>Próxima ação concreta<textarea aria-label="Próxima ação concreta" value={nextAction} onChange={event => setNextAction(event.target.value)} required maxLength={8000} rows={2} placeholder="O primeiro passo se outra IA retomar daqui."/></label>
      <label>Tarefa relacionada<select value={taskId} onChange={event => setTaskId(event.target.value)} disabled={Boolean(draft)}><option value="">Nota geral do projeto</option>{detail.tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select><small>{draft ? 'O escopo deste rascunho não muda depois de criado.' : 'Opcional. Não assume a tarefa e não exige reserva.'}</small></label>
      <div className="form-columns">
        <label>Áreas alteradas<textarea aria-label="Áreas alteradas" value={changedAreas} onChange={event => setChangedAreas(event.target.value)} rows={2} maxLength={12000} placeholder="Um caminho ou área por linha"/></label>
        <label>Pendências abertas<textarea aria-label="Pendências abertas" value={openIssues} onChange={event => setOpenIssues(event.target.value)} rows={2} maxLength={12000} placeholder="Um ponto por linha"/></label>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || !summary.trim() || !nextAction.trim() || !agent}>{busy ? 'Salvando…' : 'Salvar rascunho'}<Check size={16}/></button></div>
    </form>
  </Modal>;
}

export function DeliverHandoffDialog({ projectId, agent, checkpoint, taskTitle, onClose, onSaved }: { projectId: string; agent: string; checkpoint: Checkpoint; taskTitle?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const notify = useFeedback();
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!agent) { setError('Informe o nome do agente na barra lateral antes de entregar.'); return; }
    setError('');
    setBusy(true);
    try {
      await request(`/projects/${projectId}/deliveries`, { checkpointId: checkpoint.id, from: agent, to, message });
      notify('Passagem entregue', 'Disponível para ' + to.trim() + '.');
      await onSaved();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <Modal title="Entregar para outra IA" eyebrow="PASSAGEM ESTRUTURADA" onClose={onClose} wide>
    <p className="modal-description">A mensagem acompanha o checkpoint e será a primeira orientação lida por quem assumir. O envio não inicia uma IA.</p>
    <div className="handoff-review">
      <span className="eyebrow">O QUE SERÁ ENTREGUE</span>
      <dl>
        <div><dt>Versão</dt><dd>{checkpoint.revision}</dd></div>
        <div><dt>Tarefa vinculada</dt><dd>{taskTitle ?? 'Nota geral do projeto'}</dd></div>
        <div><dt>Trabalho concluído</dt><dd>{checkpoint.summary}</dd></div>
        <div><dt>Próximo passo</dt><dd>{checkpoint.nextStep}</dd></div>
      </dl>
    </div>
    <form onSubmit={submit} className="form-stack">
      <label>Destinatário<input autoFocus value={to} onChange={e => setTo(e.target.value)} required placeholder="Ex.: Grok ou *" maxLength={80}/><small>Use * para avisar todas as identidades do projeto.</small></label>
      <label className="handoff-message-field">Mensagem para a próxima IA<textarea aria-label="Mensagem para a próxima IA" value={message} onChange={e => setMessage(e.target.value)} rows={6} maxLength={8000} placeholder="O que a próxima IA deve ler primeiro. Pode ficar em branco."/><small>Pode ficar em branco. O próximo passo do checkpoint continua visível.</small></label>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || !to.trim() || !agent}>{busy ? 'Entregando…' : 'Entregar passagem'}<Send size={15}/></button></div>
    </form>
  </Modal>;
}

export function ExportDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [handoff, setHandoff] = useState<Handoff | null>(null); const [error, setError] = useState(''); const [copied, setCopied] = useState(false); const [bundleBusy, setBundleBusy] = useState(false);
  useEffect(() => { let active = true; api.handoff(project.id).then(data => { if (active) setHandoff(data); }).catch(err => { if (active) setError(errorText(err)); }); return () => { active = false; }; }, [project.id]);
  async function copy() { try { await navigator.clipboard.writeText(handoff!.markdown); setCopied(true); } catch { setError('A cópia automática não está disponível. Selecione o texto abaixo ou baixe o arquivo.'); } }
  function download() { const url = URL.createObjectURL(new Blob([handoff!.markdown], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'axon-contexto.md'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function downloadBundle() {
    setBundleBusy(true); setError('');
    try {
      const bundle = await request<unknown>('/projects/' + project.id + '/bundle?version=3');
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'axon-project.json'; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(errorText(err)); } finally { setBundleBusy(false); }
  }
  return <Modal title="Exportar contexto" eyebrow="RETOMADA" onClose={onClose} wide><p className="modal-description">{project.name} · {handoff ? `versão ${handoff.revision} · ${handoff.markdown.length.toLocaleString('pt-BR')} caracteres` : 'Preparando pacote…'}</p>{error && <div role="alert" className="alert">{error}</div>}{handoff ? <>{handoff.truncated && <div className="notice">O pacote foi reduzido para respeitar o limite de tamanho. Consulte o projeto para o histórico completo.</div>}<label className="export-label" htmlFor="export-context">Contexto para compartilhar</label><textarea className="export-preview" id="export-context" value={handoff.markdown} readOnly spellCheck={false}/><p className="subtle-text">Confira antes de compartilhar. O mascaramento de segredos conhecidos é auxiliar e não garante a remoção de todo dado sensível.</p>{copied && <div className="copy-status" role="status"><Check size={15}/>Contexto copiado.</div>}<div className="modal-actions export-actions"><button className="button secondary" disabled={bundleBusy} onClick={() => void downloadBundle()}><ArrowDownToLine size={16}/>{bundleBusy ? 'Preparando…' : 'Baixar pacote AXON'}</button><button className="button secondary" onClick={download}><ArrowDownToLine size={16}/>Baixar Markdown</button><button className="button primary" onClick={() => void copy()}><Copy size={16}/>Copiar contexto</button></div></> : !error && <div className="loading" role="status"><RefreshCw size={18}/>Preparando contexto…</div>}</Modal>;
}


export function ImportProjectDialog({ onClose, onImported }: { onClose: () => void; onImported: (project: Project) => void }) {
  const notify = useFeedback();
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function loadFile(file?: File) {
    if (!file) return;
    if (file.size > 1024 * 1024) { setError('O pacote excede o limite de 1 MB.'); return; }
    setSource(await file.text());
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    let bundle: unknown;
    try { bundle = JSON.parse(source); } catch { setError('O conteúdo não é um JSON válido.'); return; }
    setBusy(true);
    try {
      const result = await request<ImportProjectResult>('/import', { bundle });
      notify('Projeto importado', 'Uma cópia independente foi criada.');
      onImported(result.project);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <Modal title="Importar projeto" eyebrow="PACOTE AXON" onClose={onClose} wide>
    <p className="modal-description">Importe um pacote JSON exportado pelo AXON. Tarefas entram liberadas e os identificadores são recriados.</p>
    <form className="form-stack" onSubmit={submit}>
      <label className="file-drop">Escolher arquivo JSON<input type="file" accept=".json,application/json" onChange={event => void loadFile(event.target.files?.[0])}/><small>Até 1 MB. O arquivo é validado antes de entrar no workspace.</small></label>
      <label>Pacote JSON<textarea aria-label="Pacote JSON" autoFocus value={source} onChange={event => setSource(event.target.value)} rows={10} placeholder={'{ "format": "axon-project", ... }'} spellCheck={false}/></label>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || !source.trim()}>{busy ? 'Importando…' : 'Importar cópia'}<ArrowRight size={16}/></button></div>
    </form>
  </Modal>;
}

export function DeleteProjectDialog({ project, onClose, onDeleted }: { project: Project; onClose: () => void; onDeleted: (projectId: string) => void }) {
  const notify = useFeedback();
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ tasks: number; checkpoints: number; messages: number; backlog: number } | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      api.project(project.id),
      api.backlog(project.id, undefined, true).catch((): BacklogItem[] => []),
    ]).then(([detail, backlog]) => {
      if (!active) return;
      setSummary({
        tasks: detail.tasks.length,
        checkpoints: detail.checkpoints.length,
        messages: detail.messages.length,
        backlog: Array.isArray(backlog) ? backlog.length : 0,
      });
    }).catch(err => { if (active) setError(errorText(err)); });
    return () => { active = false; };
  }, [project.id]);
  const matches = confirmation === project.name;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!matches) return;
    setError('');
    setBusy(true);
    try {
      await api.deleteProject(project.id, confirmation);
      notify('Projeto excluído', project.name);
      onDeleted(project.id);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <Modal title="Excluir projeto" eyebrow="EXCLUSÃO PERMANENTE" onClose={onClose}>
    <p className="modal-description">Remove o projeto, backlog, tarefas, checkpoints, mensagens e passagens. Não pode ser desfeito.</p>
    <div className="handoff-review delete-summary">
      <span className="eyebrow">O QUE SERÁ REMOVIDO</span>
      {summary ? <dl>
        <div><dt>Tarefas</dt><dd>{summary.tasks}</dd></div>
        <div><dt>Checkpoints</dt><dd>{summary.checkpoints}</dd></div>
        <div><dt>Mensagens</dt><dd>{summary.messages}</dd></div>
        <div><dt>Itens de backlog</dt><dd>{summary.backlog}</dd></div>
      </dl> : <p className="subtle-text">Contando o que está neste projeto…</p>}
    </div>
    <form className="form-stack" onSubmit={event => void submit(event)}>
      <label>Digite o nome do projeto<input autoFocus value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={project.name} autoComplete="off" spellCheck={false} aria-invalid={confirmation.length > 0 && !matches}/><small>Escreva exatamente {project.name}.</small></label>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" className="button danger" disabled={busy || !matches}>{busy ? 'Excluindo…' : 'Excluir projeto'}</button>
      </div>
    </form>
  </Modal>;
}

export function DeleteBacklogItemDialog({ item, onClose, onConfirm, busy, error }: { item: BacklogItem; onClose: () => void; onConfirm: () => void; busy: boolean; error: string }) {
  return <Modal title="Excluir ideia arquivada" eyebrow="EXCLUSÃO PERMANENTE" onClose={onClose}>
    <p className="modal-description">Remove <strong>{item.title}</strong> do backlog. Tarefas, checkpoints e mensagens permanecem.</p>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="modal-actions">
      <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="button danger" disabled={busy} onClick={onConfirm}>{busy ? 'Excluindo…' : 'Excluir permanentemente'}</button>
    </div>
  </Modal>;
}

export function ProposeDecisionDialog({ projectId, agent, onClose, onSaved }: { projectId: string; agent: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const notify = useFeedback();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [proposedBy, setProposedBy] = useState(agent || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!proposedBy.trim()) {
      setError('Informe o identificador do autor ou agente proponente.');
      return;
    }
    if (!title.trim() || !body.trim()) {
      setError('Título e conteúdo da decisão são obrigatórios.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api.proposeDecision(projectId, {
        agent: proposedBy.trim(),
        title: title.trim(),
        body: body.trim(),
        note: note.trim() || undefined,
        source: { kind: 'agent_proposal', note: note.trim() || undefined },
      });
      notify('Decisão proposta', title.trim());
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Propor decisão" eyebrow="DECISÃO CANÔNICA" onClose={onClose} wide>
      <p className="modal-description">
        Propostas registram escolhas de arquitetura ou produto. Elas passam a valer no projeto e a integrar o briefing somente após serem <strong>aceitas pelo operador</strong>.
      </p>
      <form onSubmit={submit} className="form-stack">
        <label>
          Título da decisão
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Ex.: Usar SQLite em modo WAL para persistência local"
            required
            maxLength={200}
          />
        </label>
        <label>
          Conteúdo e justificativa
          <textarea
            aria-label="Conteúdo e justificativa"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Descreva a decisão tomada, o contexto, alternativas descartadas e impacto..."
            required
            maxLength={8000}
            rows={4}
          />
        </label>
        <div className="form-columns">
          <label>
            Proposto por (agente ou autor)
            <input
              value={proposedBy}
              onChange={e => setProposedBy(e.target.value)}
              placeholder="Ex.: Claude, Gemini, Arquiteto..."
              required
              maxLength={80}
            />
          </label>
          <label>
            Nota de contexto (opcional)
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ex.: Decidido após benchmark de I/O"
              maxLength={2000}
            />
          </label>
        </div>
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button primary" disabled={busy || !title.trim() || !body.trim() || !proposedBy.trim()}>
            {busy ? 'Salvando…' : 'Propor decisão'}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AcceptDecisionDialog({ projectId, agent, decision, onClose, onSaved }: { projectId: string; agent: string; decision: Decision; onClose: () => void; onSaved: () => Promise<void> }) {
  const notify = useFeedback();
  const [actor, setActor] = useState(agent || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!actor.trim()) {
      setError('Informe o nome do operador humano responsável pelo aceite.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api.acceptDecision(projectId, decision.id, {
        actor: actor.trim(),
        expectedVersion: decision.version,
      });
      notify('Decisão aceita', decision.title);
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Aceitar decisão" eyebrow={`DECISÃO · v${decision.version}`} onClose={onClose}>
      <p className="modal-description">
        Ao aceitar, esta decisão torna-se <strong>vigente</strong> e passa a compor o briefing das próximas IAs que retomarem o projeto.
      </p>
      <div className="handoff-review">
        <span className="eyebrow">DETALHES DA PROPOSTA</span>
        <dl>
          <div><dt>Título</dt><dd>{decision.title}</dd></div>
          <div><dt>Proposta por</dt><dd>{decision.proposedBy}</dd></div>
          <div><dt>Justificativa</dt><dd>{decision.body}</dd></div>
        </dl>
      </div>
      <form onSubmit={submit} className="form-stack">
        <label>
          Operador humano responsável
          <input
            autoFocus
            value={actor}
            onChange={e => setActor(e.target.value)}
            placeholder="Seu nome ou identificador"
            required
            maxLength={80}
          />
          <small>Decisões canônicas exigem a identificação de quem validou a proposta.</small>
        </label>
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button primary" disabled={busy || !actor.trim()}>
            {busy ? 'Aceitando…' : 'Aceitar decisão'}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RevokeDecisionDialog({ projectId, agent, decision, onClose, onSaved }: { projectId: string; agent: string; decision: Decision; onClose: () => void; onSaved: () => Promise<void> }) {
  const notify = useFeedback();
  const [actor, setActor] = useState(agent || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!actor.trim()) {
      setError('Informe o nome do operador humano que está revogando.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api.revokeDecision(projectId, decision.id, {
        actor: actor.trim(),
        expectedVersion: decision.version,
        note: note.trim() || undefined,
      });
      notify('Decisão revogada', decision.title);
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Revogar decisão" eyebrow={`REVOGAÇÃO · v${decision.version}`} onClose={onClose}>
      <p className="modal-description">
        Revogar remove a vigência desta decisão. Ela <strong>deixa de constar no briefing ativo</strong>, mas seu registro permanece arquivado para auditoria e histórico.
      </p>
      <div className="handoff-review">
        <span className="eyebrow">DECISÃO A REVOGAR</span>
        <dl>
          <div><dt>Título</dt><dd>{decision.title}</dd></div>
          <div><dt>Aceita por</dt><dd>{decision.acceptedBy ?? decision.proposedBy}</dd></div>
        </dl>
      </div>
      <form onSubmit={submit} className="form-stack">
        <label>
          Operador humano responsável
          <input
            autoFocus
            value={actor}
            onChange={e => setActor(e.target.value)}
            placeholder="Seu nome ou identificador"
            required
            maxLength={80}
          />
        </label>
        <label>
          Motivo da revogação (opcional)
          <textarea
            aria-label="Motivo da revogação"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Por que esta decisão não deve mais vigorar?"
            rows={2}
            maxLength={2000}
          />
        </label>
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button danger" disabled={busy || !actor.trim()}>
            {busy ? 'Revogando…' : 'Revogar decisão'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SupersedeDecisionDialog({ projectId, agent, decision, onClose, onSaved }: { projectId: string; agent: string; decision: Decision; onClose: () => void; onSaved: () => Promise<void> }) {
  const notify = useFeedback();
  const [title, setTitle] = useState(decision.title);
  const [body, setBody] = useState(decision.body);
  const [actor, setActor] = useState(agent || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!actor.trim()) {
      setError('Informe o nome do operador humano responsável pela substituição.');
      return;
    }
    if (!title.trim() || !body.trim()) {
      setError('Título e conteúdo da nova decisão são obrigatórios.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api.supersedeDecision(projectId, decision.id, {
        actor: actor.trim(),
        expectedVersion: decision.version,
        title: title.trim(),
        body: body.trim(),
        note: note.trim() || undefined,
      });
      notify('Decisão substituída', title.trim());
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Substituir decisão" eyebrow={`LINHAGEM · SUBSTITUI v${decision.version}`} onClose={onClose} wide>
      <p className="modal-description">
        Cria uma nova versão <strong>vigente</strong> que substitui formalmente a decisão anterior. A versão anterior passa ao estado substituída, mantendo a linhagem rastreável.
      </p>
      <div className="handoff-review">
        <span className="eyebrow">VERSÃO ANTERIOR SENDO SUBSTITUÍDA</span>
        <dl>
          <div><dt>Título anterior</dt><dd>{decision.title}</dd></div>
        </dl>
      </div>
      <form onSubmit={submit} className="form-stack">
        <label>
          Novo título da decisão
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Ex.: Migrar de SQLite para PostgreSQL para suportar concorrência"
            required
            maxLength={200}
          />
        </label>
        <label>
          Novo conteúdo e justificativa
          <textarea
            aria-label="Novo conteúdo e justificativa"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Descreva a nova diretiva e por que a anterior foi superada..."
            required
            maxLength={8000}
            rows={4}
          />
        </label>
        <div className="form-columns">
          <label>
            Operador humano responsável
            <input
              value={actor}
              onChange={e => setActor(e.target.value)}
              placeholder="Seu nome ou identificador"
              required
              maxLength={80}
            />
          </label>
          <label>
            Nota sobre a mudança (opcional)
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ex.: Mudança de requisito após análise de carga"
              maxLength={2000}
            />
          </label>
        </div>
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button primary" disabled={busy || !title.trim() || !body.trim() || !actor.trim()}>
            {busy ? 'Substituindo…' : 'Substituir e ativar nova versão'}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TaskContractDialog({
  projectId,
  task,
  tasks,
  onClose,
  onSaved,
}: {
  projectId: string;
  task: Task;
  tasks: Task[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const notify = useFeedback();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority ?? 'medium');
  const [criteria, setCriteria] = useState<Array<{ id: string; description: string; completed: boolean }>>(
    (task.acceptanceCriteria ?? []).map(c => ({ id: c.id, description: c.description, completed: c.completed }))
  );
  const [selectedDeps, setSelectedDeps] = useState<string[]>(task.dependencyTaskIds ?? []);
  const [outputs, setOutputs] = useState<Array<{ id: string; title: string; kind: ExpectedOutputKind; locator: string }>>(
    (task.expectedOutputs ?? []).map(o => ({ id: o.id, title: o.title, kind: o.kind, locator: o.locator ?? '' }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const otherTasks = tasks.filter(t => t.id !== task.id);

  function addCriterion() {
    setCriteria(prev => [...prev, { id: crypto.randomUUID(), description: '', completed: false }]);
  }

  function removeCriterion(index: number) {
    setCriteria(prev => prev.filter((_, i) => i !== index));
  }

  function updateCriterionText(index: number, text: string) {
    setCriteria(prev => prev.map((c, i) => (i === index ? { ...c, description: text } : c)));
  }

  function toggleCriterionComplete(index: number) {
    setCriteria(prev => prev.map((c, i) => (i === index ? { ...c, completed: !c.completed } : c)));
  }

  function addOutput() {
    setOutputs(prev => [...prev, { id: crypto.randomUUID(), title: '', kind: 'file_path', locator: '' }]);
  }

  function removeOutput(index: number) {
    setOutputs(prev => prev.filter((_, i) => i !== index));
  }

  function updateOutputField(index: number, field: 'title' | 'kind' | 'locator', value: string) {
    setOutputs(prev => prev.map((o, i) => (i === index ? { ...o, [field]: value } : o)));
  }

  function toggleDependency(depId: string) {
    setSelectedDeps(prev =>
      prev.includes(depId) ? prev.filter(id => id !== depId) : [...prev, depId]
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('O título da tarefa não pode ficar vazio.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.updateTaskContract(projectId, task.id, {
        expectedVersion: task.version,
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        priority,
        acceptanceCriteria: criteria
          .filter(c => c.description.trim().length > 0)
          .map(c => ({ id: c.id, description: c.description.trim(), completed: c.completed })),
        dependencyTaskIds: selectedDeps,
        expectedOutputs: outputs
          .filter(o => o.title.trim().length > 0)
          .map(o => ({ id: o.id, title: o.title.trim(), kind: o.kind, locator: o.locator.trim() || undefined })),
      });
      notify('Detalhes atualizados', `Tarefa "${title.trim()}" salva.`);
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Detalhes da tarefa" eyebrow={`VERSÃO ${task.version} · DETALHES DE EXECUÇÃO`} onClose={onClose} wide>
      <p className="modal-description">
        Defina prioridade, critérios de aceite verificáveis, dependências acíclicas e saídas esperadas para orientar qualquer IA.
      </p>
      <form onSubmit={submit} className="form-stack">
        <div className="form-columns">
          <label>
            Título da tarefa
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex.: Implementar compilador AST"
              required
              maxLength={200}
            />
          </label>
          <label>
            Prioridade
            <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}>
              <option value="urgent">Urgente</option>
              <option value="high">Alta</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </select>
          </label>
        </div>

        <label>
          Descrição e especificação
          <textarea
            aria-label="Descrição e especificação"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Detalhes técnicos, regras de negócio ou restrições essenciais para a IA..."
            maxLength={4000}
            rows={3}
          />
        </label>

        {/* Critérios de Aceite */}
        <div className="contract-section">
          <div className="contract-section-header">
            <div>
              <strong className="contract-section-title">Critérios de aceite</strong>
              <small className="contract-section-desc">Condições obrigatórias para a tarefa ser considerada concluída.</small>
            </div>
            <button type="button" className="button secondary small-btn" onClick={addCriterion}>
              <Plus size={13} /> Critério
            </button>
          </div>
          {criteria.length === 0 ? (
            <p className="empty-section-hint">Nenhum critério definido ainda. Adicione itens para a IA conferir.</p>
          ) : (
            <div className="contract-items-list">
              {criteria.map((c, i) => (
                <div key={c.id || i} className="contract-criterion-row">
                  <button
                    type="button"
                    className={`criterion-check-btn ${c.completed ? 'checked' : ''}`}
                    onClick={() => toggleCriterionComplete(i)}
                    title={c.completed ? 'Marcar como pendente' : 'Marcar como concluído'}
                  >
                    {c.completed ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>
                  <input
                    className="criterion-input"
                    value={c.description}
                    onChange={e => updateCriterionText(i, e.target.value)}
                    placeholder="Ex.: Validação de tipos implementada com testes unitários"
                    maxLength={1000}
                  />
                  <button
                    type="button"
                    className="icon-button-danger"
                    onClick={() => removeCriterion(i)}
                    title="Remover critério"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dependências */}
        <div className="contract-section">
          <div className="contract-section-header">
            <div>
              <strong className="contract-section-title">Dependências necessárias</strong>
              <small className="contract-section-desc">Tarefas que precisam estar concluídas antes desta ser assumida.</small>
            </div>
          </div>
          {otherTasks.length === 0 ? (
            <p className="empty-section-hint">Não há outras tarefas cadastradas neste projeto para vincular como dependência.</p>
          ) : (
            <div className="contract-deps-grid">
              {otherTasks.map(t => {
                const selected = selectedDeps.includes(t.id);
                const isDone = t.status === 'done';
                return (
                  <label key={t.id} className={`contract-dep-card ${selected ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleDependency(t.id)}
                    />
                    <div className="contract-dep-info">
                      <span className="contract-dep-title">{t.title}</span>
                      <span className={`dep-status-pill ${isDone ? 'done' : 'pending'}`}>
                        {isDone ? '✓ Concluída' : t.status === 'in_progress' ? 'Em andamento' : 'Pendente'}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Saídas Esperadas */}
        <div className="contract-section">
          <div className="contract-section-header">
            <div>
              <strong className="contract-section-title">Saídas esperadas</strong>
              <small className="contract-section-desc">Arquivos, artefatos ou documentos gerados como entrega.</small>
            </div>
            <button type="button" className="button secondary small-btn" onClick={addOutput}>
              <Plus size={13} /> Saída
            </button>
          </div>
          {outputs.length === 0 ? (
            <p className="empty-section-hint">Nenhuma saída declarada. Indique arquivos ou artefatos esperados.</p>
          ) : (
            <div className="contract-items-list">
              {outputs.map((o, i) => (
                <div key={o.id || i} className="contract-output-row">
                  <input
                    className="output-title-input"
                    value={o.title}
                    onChange={e => updateOutputField(i, 'title', e.target.value)}
                    placeholder="Título (ex.: Módulo parser)"
                    maxLength={200}
                  />
                  <select
                    className="output-kind-select"
                    value={o.kind}
                    onChange={e => updateOutputField(i, 'kind', e.target.value as ExpectedOutputKind)}
                  >
                    <option value="file_path">Arquivo</option>
                    <option value="content_item">Conteúdo</option>
                    <option value="artifact">Artefato</option>
                    <option value="design_asset">Design</option>
                    <option value="dataset">Dataset</option>
                    <option value="other">Outro</option>
                  </select>
                  <input
                    className="output-locator-input"
                    value={o.locator}
                    onChange={e => updateOutputField(i, 'locator', e.target.value)}
                    placeholder="Caminho (ex.: src/parser.ts)"
                    maxLength={1000}
                  />
                  <button
                    type="button"
                    className="icon-button-danger"
                    onClick={() => removeOutput(i)}
                    title="Remover saída"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="alert" role="alert">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button primary" disabled={busy || !title.trim()}>
            {busy ? 'Salvando…' : 'Salvar detalhes'}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ConnectAgentDialog({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const notify = useFeedback();
  const [connectors, setConnectors] = useState<ConnectorsInfo | null>(null);
  const [activeTab, setActiveTab] = useState<'cursor' | 'claude' | 'gemini' | 'vscode' | 'protocol'>('cursor');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api.connectors(controller.signal)
      .then(info => {
        if (!controller.signal.aborted) setConnectors(info);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const command = connectors?.mcpCommand ?? 'node';
  const args = connectors?.mcpArgs ?? ['--import', './node_modules/tsx/dist/loader.mjs', './server/mcp.ts'];
  const pName = project?.name ?? 'Meu Projeto';
  const pId = project?.id ?? '<PROJECT_ID>';
  const pObj = project?.objective ?? 'Objetivo do projeto.';
  const pPath = project?.workspacePath ?? '';

  const mcpConfigObj = {
    mcpServers: {
      axon: {
        command,
        args,
      },
    },
  };
  const mcpConfigJson = JSON.stringify(mcpConfigObj, null, 2);

  const cursorRules = `---
description: Axon Works Continuity Protocol
globs: *
alwaysApply: true
---
Você está trabalhando no projeto "${pName}" gerenciado pelo Axon Works.
- Projeto ID: ${pId}
- Objetivo: ${pObj}

Diretrizes obrigatórias de continuidade:
1. Ao iniciar, use a ferramenta MCP \`get_resume\` com \`projectId: "${pId}"\` e seu identificador em \`agent\`.
2. Ao escolher uma tarefa, reserve-a com \`claim_task\` usando a versão atual e siga os critérios de aceite.
3. Ao encerrar sua intervenção, chame \`finalize_work\` com evidências reais de validação e informe o próximo passo para quem assumir depois.`;

  const claudeCliCommand = `claude mcp add axon -- ${command} ${args.map(a => `"${a}"`).join(' ')}`;

  const agentsProtocol = `# Protocolo de Continuidade — Axon Works

Este repositório é gerenciado pelo **Axon Works** (correio de continuidade e memória entre IAs).

## Identificação do Projeto
- **Nome:** ${pName}
- **ID do Projeto:** \`${pId}\`
- **Objetivo:** ${pObj}
${pPath ? `- **Pasta Local:** \`${pPath}\`\n` : ''}
## Como Qualquer IA Deve Agir Neste Repositório

### 1. Entrada (Ao Iniciar a Sessão)
Consulte seu briefing de retomada chamando a ferramenta MCP do Axon:
\`\`\`json
get_resume({
  "projectId": "${pId}",
  "agent": "<seu_nome_de_IA>"
})
\`\`\`
Leia o objetivo, o último checkpoint, o próximo passo e as mensagens da sua caixa de entrada.
Confirme a leitura das mensagens recebidas com \`acknowledge_delivery\`.

### 2. Durante o Trabalho (Assumindo Tarefas)
- Liste as tarefas com \`get_project({ "projectId": "${pId}" })\`.
- Assuma sua tarefa usando controle de concorrência CAS:
\`\`\`json
claim_task({
  "projectId": "${pId}",
  "taskId": "<task_id>",
  "agent": "<seu_nome_de_IA>",
  "expectedVersion": <versao_atual>
})
\`\`\`
- Respeite os critérios de aceite e verifique se todas as dependências estão concluídas.

### 3. Saída (Passagem de Bastão para a Próxima IA)
Ao terminar sua cota, sua fatia de trabalho ou trocar de IA, encerre atomicamente:
\`\`\`json
finalize_work({
  "projectId": "${pId}",
  "agent": "<seu_nome_de_IA>",
  "summary": "<resumo do que foi feito com precisão>",
  "nextStep": "<próxima ação imediata para quem assumir>",
  "taskId": "<task_id>",
  "taskTransition": "declare_done",
  "evidence": [
    { "command": "npm test", "outcome": "passed", "details": "Todos os testes passaram" }
  ],
  "delivery": {
    "to": "<proxima_IA_ou_*>",
    "message": "<recado direto explicando onde continuar e cuidados>"
  }
})
\`\`\`

> **Nota:** Não execute comandos sem evidências reais. Evidências declaradas são relatos de agentes.`;

  async function copySnippet(text: string, key: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      notify('Copiado para a área de transferência', label);
      setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      notify('Falha ao copiar', 'Selecione e copie manualmente.');
    }
  }

  function downloadProtocol() {
    const blob = new Blob([agentsProtocol], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'AGENTS.md';
    a.click();
    URL.revokeObjectURL(url);
    notify('Download iniciado', 'Arquivo AGENTS.md baixado.');
  }

  return (
    <Modal title={project ? `Conectar IA a "${pName}"` : 'Conectar agentes de IA'} eyebrow="CONECTOR MCP & PROTOCOLO" onClose={onClose} wide>
      <p className="modal-description">
        Configure Cursor, Claude Code, Antigravity, Copilot ou gere o arquivo <strong>AGENTS.md</strong> na raiz para que qualquer IA assuma o trabalho mantendo a continuidade.
      </p>

      <div className="connector-tabs" role="tablist" aria-label="Ferramentas de IA">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'cursor'}
          className={`connector-tab-btn ${activeTab === 'cursor' ? 'active' : ''}`}
          onClick={() => setActiveTab('cursor')}
        >
          <Laptop size={13} /> Cursor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'claude'}
          className={`connector-tab-btn ${activeTab === 'claude' ? 'active' : ''}`}
          onClick={() => setActiveTab('claude')}
        >
          <Terminal size={13} /> Claude Code
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'gemini'}
          className={`connector-tab-btn ${activeTab === 'gemini' ? 'active' : ''}`}
          onClick={() => setActiveTab('gemini')}
        >
          <Plug size={13} /> Antigravity / Agy
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'vscode'}
          className={`connector-tab-btn ${activeTab === 'vscode' ? 'active' : ''}`}
          onClick={() => setActiveTab('vscode')}
        >
          <FileCode size={13} /> VS Code / Cline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'protocol'}
          className={`connector-tab-btn ${activeTab === 'protocol' ? 'active' : ''}`}
          onClick={() => setActiveTab('protocol')}
        >
          <ArrowDownToLine size={13} /> AGENTS.md
        </button>
      </div>

      <div className="connector-tab-content">
        {activeTab === 'cursor' && (
          <div className="connector-panel-view">
            <div className="connector-step-box">
              <span className="connector-step-badge">Passo 1</span>
              <p>Adicione ao arquivo <code>.cursor/mcp.json</code> na raiz do workspace:</p>
              <div className="code-snippet-box">
                <pre>{mcpConfigJson}</pre>
                <button
                  type="button"
                  className="snippet-copy-btn"
                  onClick={() => copySnippet(mcpConfigJson, 'cursor-mcp', 'Configuração .cursor/mcp.json')}
                >
                  {copiedKey === 'cursor-mcp' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'cursor-mcp' ? 'Copiado!' : 'Copiar JSON'}
                </button>
              </div>
            </div>

            {project && (
              <div className="connector-step-box">
                <span className="connector-step-badge">Passo 2</span>
                <p>Crie ou atualize o arquivo <code>.cursorrules</code> para instruir o Cursor automaticamente:</p>
                <div className="code-snippet-box">
                  <pre>{cursorRules}</pre>
                  <button
                    type="button"
                    className="snippet-copy-btn"
                    onClick={() => copySnippet(cursorRules, 'cursor-rules', 'Regra .cursorrules')}
                  >
                    {copiedKey === 'cursor-rules' ? <Check size={13} /> : <Copy size={13} />}
                    {copiedKey === 'cursor-rules' ? 'Copiado!' : 'Copiar .cursorrules'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'claude' && (
          <div className="connector-panel-view">
            <div className="connector-step-box">
              <span className="connector-step-badge">Opção A — Claude Code CLI</span>
              <p>Execute no terminal dentro do projeto para registrar o servidor MCP:</p>
              <div className="code-snippet-box">
                <pre>{claudeCliCommand}</pre>
                <button
                  type="button"
                  className="snippet-copy-btn"
                  onClick={() => copySnippet(claudeCliCommand, 'claude-cli', 'Comando Claude Code')}
                >
                  {copiedKey === 'claude-cli' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'claude-cli' ? 'Copiado!' : 'Copiar Comando'}
                </button>
              </div>
            </div>

            <div className="connector-step-box">
              <span className="connector-step-badge">Opção B — Claude Desktop</span>
              <p>Cole no arquivo <code>claude_desktop_config.json</code>:</p>
              <div className="code-snippet-box">
                <pre>{mcpConfigJson}</pre>
                <button
                  type="button"
                  className="snippet-copy-btn"
                  onClick={() => copySnippet(mcpConfigJson, 'claude-desktop', 'Configuração Claude Desktop')}
                >
                  {copiedKey === 'claude-desktop' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'claude-desktop' ? 'Copiado!' : 'Copiar JSON'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'gemini' && (
          <div className="connector-panel-view">
            <div className="connector-step-box">
              <span className="connector-step-badge">Antigravity CLI / Gemini</span>
              <p>Adicione ao arquivo de configuração MCP do seu ambiente (ex.: <code>.gemini/settings.json</code>):</p>
              <div className="code-snippet-box">
                <pre>{mcpConfigJson}</pre>
                <button
                  type="button"
                  className="snippet-copy-btn"
                  onClick={() => copySnippet(mcpConfigJson, 'gemini-mcp', 'Configuração MCP Antigravity')}
                >
                  {copiedKey === 'gemini-mcp' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'gemini-mcp' ? 'Copiado!' : 'Copiar JSON'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'vscode' && (
          <div className="connector-panel-view">
            <div className="connector-step-box">
              <span className="connector-step-badge">VS Code / Windsurf / Cline / Roo Code</span>
              <p>Cole na configuração de servidores MCP da extensão ou em <code>.vscode/mcp.json</code>:</p>
              <div className="code-snippet-box">
                <pre>{mcpConfigJson}</pre>
                <button
                  type="button"
                  className="snippet-copy-btn"
                  onClick={() => copySnippet(mcpConfigJson, 'vscode-mcp', 'Configuração MCP')}
                >
                  {copiedKey === 'vscode-mcp' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'vscode-mcp' ? 'Copiado!' : 'Copiar JSON'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'protocol' && (
          <div className="connector-panel-view">
            <div className="connector-step-box">
              <div className="protocol-action-header">
                <div>
                  <span className="connector-step-badge">Instruções para o Repositório</span>
                  <p>Guarde como <code>AGENTS.md</code> na raiz do projeto para orientar qualquer IA que abrir este código.</p>
                </div>
                <div className="protocol-header-buttons">
                  <button
                    type="button"
                    className="button secondary small-btn"
                    onClick={downloadProtocol}
                  >
                    <Download size={13} /> Baixar AGENTS.md
                  </button>
                  <button
                    type="button"
                    className="button primary small-btn"
                    onClick={() => copySnippet(agentsProtocol, 'protocol-md', 'Arquivo AGENTS.md')}
                  >
                    {copiedKey === 'protocol-md' ? <Check size={13} /> : <Copy size={13} />}
                    {copiedKey === 'protocol-md' ? 'Copiado!' : 'Copiar Markdown'}
                  </button>
                </div>
              </div>
              <div className="code-snippet-box">
                <pre>{agentsProtocol}</pre>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="button ghost" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}

export function CrossCheckEvidenceDialog({
  projectId,
  agent,
  evidence,
  onClose,
  onSaved,
}: {
  projectId: string;
  agent: string;
  evidence: EvidenceView;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const notify = useFeedback();
  const [verifiedBy, setVerifiedBy] = useState(agent && agent !== evidence.reportedBy ? agent : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const verifier = verifiedBy.trim();
    if (!verifier) {
      setError('Informe a identidade de quem confere.');
      return;
    }
    if (verifier === evidence.reportedBy) {
      setError('A mesma identidade que relatou o teste não pode conferir a própria evidência.');
      return;
    }
    if (!note.trim()) {
      setError('Descreva como e onde a evidência foi conferida.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.crossCheckEvidence(projectId, evidence.id, {
        verifiedBy: verifier,
        note: note.trim(),
      });
      notify('Conferência cruzada registrada', `Conferido por ${verifier}`);
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.code === 'self_verification_rejected')) {
        setError('A mesma identidade que relatou o teste não pode conferir a própria evidência.');
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Conferência cruzada de evidência"
      eyebrow="CONFERÊNCIA CRUZADA · RELATO INDEPENDENTE"
      onClose={onClose}
      wide
    >
      <div className="modal-description">
        <p>
          A conferência cruzada é o relato de uma segunda identidade declarada.
          <strong> Continua sendo relato — de dois.</strong> Não transforma relato em fato do sistema.
        </p>
      </div>

      <div className="cross-check-preview" style={{ background: '#212428', padding: '14px', borderRadius: '6px', marginBottom: '18px', border: '1px solid #4a5056' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '11px', color: '#a0aab7' }}>
          <span>Relatado por: <strong style={{ color: '#dae1e9' }}>{evidence.reportedBy}</strong></span>
          <code style={{ background: '#181a1d', padding: '3px 6px', borderRadius: '4px', color: '#e5e7eb' }}>{evidence.command}</code>
        </div>
        {evidence.details && <p style={{ fontSize: '10px', color: '#b1bcca', margin: 0 }}>{evidence.details}</p>}
      </div>

      <form onSubmit={submit} className="form-stack">
        <label>
          Identidade de quem confere
          <input
            aria-label="Identidade de quem confere"
            value={verifiedBy}
            onChange={e => setVerifiedBy(e.target.value)}
            placeholder="Nome da outra IA ou operador que conferiu o teste"
            required
            maxLength={80}
            disabled={busy}
          />
          <small>
            A mesma identidade que relatou o teste ({evidence.reportedBy}) não pode conferir a própria evidência.
          </small>
        </label>

        <label>
          Nota da conferência
          <textarea
            aria-label="Nota da conferência"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Ex.: Conferi o comando e a saída gerada no ambiente de testes. Os testes passaram com 263/263 aprovados."
            required
            maxLength={2000}
            rows={3}
            disabled={busy}
          />
        </label>

        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="button primary" disabled={busy || !verifiedBy.trim() || !note.trim()}>
            {busy ? 'Gravando…' : 'Registrar conferência'}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function BlockerTimelineDialog({
  projectId,
  blocker,
  onClose,
}: {
  projectId: string;
  blocker: ProjectBlocker;
  onClose: () => void;
}) {
  const [timeline, setTimeline] = useState<BlockerTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api.blockerTimeline(projectId, blocker.id, controller.signal)
      .then(tl => setTimeline(tl))
      .catch(err => setError(errorText(err)))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [projectId, blocker.id]);

  const transitionsMap: Record<string, string> = {
    opened: 'Aberto',
    mitigated: 'Mitigado',
    resolved: 'Resolvido',
    accepted_risk: 'Risco aceito',
    reopened: 'Reaberto',
  };

  return (
    <Modal
      title={`Linha do tempo do bloqueio "${blocker.title}"`}
      eyebrow="HISTÓRICO IMUTÁVEL · BLOQUEIO"
      onClose={onClose}
      wide
    >
      <p className="modal-description">
        Todas as transições deste bloqueio formam uma sequência imutável de eventos.
        Reabrir um bloqueio não apaga a resolução anterior — o histórico é preservado.
      </p>

      {loading && (
        <div className="loading" role="status">
          <RefreshCw size={17} />
          Carregando linha do tempo…
        </div>
      )}

      {error && <div className="alert" role="alert">{error}</div>}

      {timeline && timeline.events.length === 0 && (
        <p className="subtle-text">Nenhum evento registrado ainda.</p>
      )}

      {timeline && timeline.events.length > 0 && (
        <div className="timeline" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {timeline.events.map((evt, idx) => (
            <div key={evt.id || idx} className="timeline-item" style={{ paddingBottom: '12px' }}>
              <span className="timeline-dot" />
              <div style={{ flex: 1 }}>
                <div className="timeline-meta" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className={`status-tag micro ${evt.transition}`}>
                    {transitionsMap[evt.transition] || evt.transition}
                  </span>
                  <span className="revision-badge">v{evt.version}</span>
                  <strong>{evt.actor}</strong>
                  {evt.createdAt && <DateLabel value={evt.createdAt} />}
                </div>
                {evt.fromStatus && (
                  <div style={{ fontSize: '10px', color: '#9a9893', marginTop: '4px' }}>
                    De <code>{evt.fromStatus}</code> para <code>{evt.toStatus}</code>
                  </div>
                )}
                {evt.note && <p style={{ margin: '6px 0 0', color: '#d0cec9', fontSize: '11px' }}>{evt.note}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}

export function DecisionTimelineDialog({
  projectId,
  decision,
  onClose,
}: {
  projectId: string;
  decision: Decision;
  onClose: () => void;
}) {
  const [timeline, setTimeline] = useState<DecisionTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api.decisionTimeline(projectId, decision.id, controller.signal)
      .then(tl => setTimeline(tl))
      .catch(err => setError(errorText(err)))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [projectId, decision.id]);

  const transitionsMap: Record<string, string> = {
    proposed: 'Proposta',
    accepted: 'Aceita',
    revoked: 'Revogada',
    superseded: 'Substituída',
    replaced_by: 'Substituída por outra',
  };

  return (
    <Modal
      title={`Linha do tempo da decisão "${decision.title}"`}
      eyebrow="HISTÓRICO IMUTÁVEL · DECISÃO"
      onClose={onClose}
      wide
    >
      <p className="modal-description">
        Histórico imutável de transições da decisão. Revogar ou substituir não apaga
        a proposta original nem o histórico prévio.
      </p>

      {loading && (
        <div className="loading" role="status">
          <RefreshCw size={17} />
          Carregando linha do tempo…
        </div>
      )}

      {error && <div className="alert" role="alert">{error}</div>}

      {timeline && timeline.events.length === 0 && (
        <p className="subtle-text">Nenhum evento registrado ainda.</p>
      )}

      {timeline && timeline.events.length > 0 && (
        <div className="timeline" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {timeline.events.map((evt, idx) => (
            <div key={evt.id || idx} className="timeline-item" style={{ paddingBottom: '12px' }}>
              <span className="timeline-dot" />
              <div style={{ flex: 1 }}>
                <div className="timeline-meta" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className={`status-tag micro ${evt.transition}`}>
                    {transitionsMap[evt.transition] || evt.transition}
                  </span>
                  <span className="revision-badge">v{evt.version}</span>
                  <strong>{evt.actor}</strong>
                  {evt.createdAt && <DateLabel value={evt.createdAt} />}
                </div>
                {evt.fromStatus && (
                  <div style={{ fontSize: '10px', color: '#9a9893', marginTop: '4px' }}>
                    De <code>{evt.fromStatus}</code> para <code>{evt.toStatus}</code>
                  </div>
                )}
                {evt.note && <p style={{ margin: '6px 0 0', color: '#d0cec9', fontSize: '11px' }}>{evt.note}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}

