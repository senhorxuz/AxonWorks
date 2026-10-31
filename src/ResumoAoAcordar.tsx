import { useEffect, useRef, useState } from 'react';
import { Sunrise, CheckCircle2, Hourglass, Lock, TrendingUp, ArrowRight, Flame, GitCommitHorizontal, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ProjectDetail, Task, Checkpoint } from '../shared/types';
import type { EvidenceView } from '../shared/evidence';
import type { ProjectInsights } from '../shared/insights';
import type { ApprovalRequest } from '../shared/approvals';
import { api, request } from './api';
import { DateLabel } from './ui';
import { animarEntradaResumo } from './recompensas';
import { nivelDeConfianca } from './confianca';
import './painel.css';

/**
 * Parte 7 — Resumo ao acordar.
 * Esqueleto criado pela orquestradora; o agente do painel preenche o corpo.
 * Para apagar esta parte: remova este arquivo, src/painel.css (se a fila tambem
 * sair) e a linha de montagem <ResumoAoAcordar> em src/Workspace.tsx.
 *
 * Regra de honestidade: nenhum numero, selo ou frase aparece sem dado real por
 * tras. `insights === undefined` significa "ainda nao chegou" — nunca vira 0.
 * Listas vazias dizem o que sao. Nenhuma nota, indice ou ranking.
 */

const PREFIXO_VISITA = 'axon-ultima-visita-';
const UM_DIA_MS = 24 * 60 * 60 * 1000;

function lerUltimaVisita(projectId: string): { desde: Date; primeiraVisita: boolean } {
  try {
    const salvo = localStorage.getItem(PREFIXO_VISITA + projectId);
    if (salvo) {
      const data = new Date(salvo);
      if (!Number.isNaN(data.getTime())) return { desde: data, primeiraVisita: false };
    }
  } catch {
    /* Armazenamento local pode falhar (navegação privada, cota, etc.); cai no padrão de 24 horas. */
  }
  return { desde: new Date(Date.now() - UM_DIA_MS), primeiraVisita: true };
}

function gravarVisita(projectId: string, quando: Date) {
  try { localStorage.setItem(PREFIXO_VISITA + projectId, quando.toISOString()); } catch { /* Preferência não é essencial. */ }
}

function formatarDesde(desde: Date): string {
  const agora = new Date();
  const hora = desde.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const mesmoDia = desde.toDateString() === agora.toDateString();
  if (mesmoDia) return `desde hoje, ${hora}`;
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (desde.toDateString() === ontem.toDateString()) return `desde ontem, ${hora}`;
  const data = desde.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `desde ${data}, ${hora}`;
}

function pluralizar(n: number, singular: string, plural: string): string {
  return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
}


interface TarefaConcluida { tarefa: Task; registro: Checkpoint }

function ResumoTecnicoItem({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = summary.length > 100 || summary.includes('\n');
  const preview = isLong ? summary.slice(0, 85) + '…' : summary;

  return (
    <p className="resumo-tecnico">
      <span>Resumo técnico (escrito por uma IA para outra IA)</span>
      {expanded || !isLong ? summary : preview}
      {isLong && (
        <button
          type="button"
          className="resumo-tecnico-toggle"
          onClick={() => setExpanded(prev => !prev)}
        >
          {expanded ? 'Ver menos' : 'Ver mais'}
        </button>
      )}
    </p>
  );
}

export function ResumoAoAcordar(props: {
  projectId: string;
  detail: ProjectDetail;
  /** undefined = ainda nao chegou; nunca mostre numeros nesse estado. */
  insights: ProjectInsights | undefined;
  /** Leva o dono ate a fila de aprovacoes. */
  onOpenApprovals: () => void;
}) {
  const { projectId, detail, insights, onOpenApprovals } = props;
  const listaProntoRef = useRef<HTMLUListElement>(null);

  // "Desde sua última visita": lido uma vez por projeto e regravado com o
  // momento atual, para a próxima visita começar exatamente daqui.
  const [periodo, setPeriodo] = useState<{ desde: Date; primeiraVisita: boolean } | null>(null);
  useEffect(() => {
    const lido = lerUltimaVisita(projectId);
    setPeriodo(lido);
    gravarVisita(projectId, new Date());
  }, [projectId]);

  // Propostas pendentes (Parte 5): buscadas aqui só para o contador do atalho
  // "Esperando por você" — a lista completa é responsabilidade da FilaDeAprovacoes.
  const [propostasPendentes, setPropostasPendentes] = useState<ApprovalRequest[] | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    request<ApprovalRequest[]>(`/projects/${projectId}/approvals?status=pending`, undefined, controller.signal, 'GET')
      .then(items => { if (!controller.signal.aborted) setPropostasPendentes(items); })
      .catch(() => { if (!controller.signal.aborted) setPropostasPendentes(undefined); });
    return () => controller.abort();
    // Recarrega a cada atualização do projeto (inclui decisões tomadas na fila).
  }, [projectId, detail]);

  const desde = periodo?.desde;
  const tarefasConcluidas: TarefaConcluida[] = !desde ? [] : detail.tasks
    .filter(t => t.status === 'done' && !!t.completionCheckpointId)
    .reduce<TarefaConcluida[]>((acc, tarefa) => {
      const registro = detail.checkpoints.find(cp => cp.id === tarefa.completionCheckpointId);
      if (registro && new Date(registro.createdAt).getTime() >= desde.getTime()) acc.push({ tarefa, registro });
      return acc;
    }, [])
    .sort((a, b) => new Date(b.registro.createdAt).getTime() - new Date(a.registro.createdAt).getTime());

  useEffect(() => {
    if (tarefasConcluidas.length > 0 && listaProntoRef.current) {
      animarEntradaResumo(listaProntoRef.current);
    }
  }, [tarefasConcluidas.length]);

  // Evidência (Informado pela IA / Conferido por outra IA / Arquivos conferidos
  // pelo sistema): busca própria, não é insights — só pedida quando há algo
  // concluído a explicar, para não gastar uma requisição à toa.
  const [evidencias, setEvidencias] = useState<EvidenceView[]>([]);
  const temConcluidas = tarefasConcluidas.length > 0;
  useEffect(() => {
    if (!temConcluidas) { setEvidencias([]); return; }
    const controller = new AbortController();
    api.evidence(projectId, {}, controller.signal)
      .then(items => { if (!controller.signal.aborted) setEvidencias(items); })
      .catch(() => { if (!controller.signal.aborted) setEvidencias([]); });
    return () => controller.abort();
  }, [projectId, detail, temConcluidas]);

  if (!periodo) return null;

  const contagemPendentes = propostasPendentes?.length;
  const stalledTasks = insights?.stalledTasks ?? [];
  const bloqueiosAbertos = insights?.signals.openBlockers;
  const evidenciasDesatualizadas = insights?.signals.staleEvidenceOnDoneTasks;
  const temTravado = stalledTasks.length > 0 || (bloqueiosAbertos?.count ?? 0) > 0;
  const temEvidenciasDesatualizadas = (evidenciasDesatualizadas?.count ?? 0) > 0;
  const temPendentes = contagemPendentes !== undefined && contagemPendentes > 0;
  const temAtividade = detail.tasks.length > 0 || detail.checkpoints.length > 0;
  const tudoEmDia = temAtividade && !temTravado && !temPendentes;
  const proximosPassos = insights?.nextActions.slice(0, 3) ?? [];
  const momentum = insights?.momentum;
  const temMomentum = !!momentum && (momentum.tasksCompletedLast24h > 0 || momentum.checkpointsLast24h > 0 || momentum.streakDays > 0);

  return (
    <section className="resumo-ao-acordar" aria-label="Resumo ao acordar">
      <div className="resumo-header">
        <span className="eyebrow"><Sunrise size={15} />RESUMO AO ACORDAR</span>
        <h2>{periodo.primeiraVisita ? 'Resumo das últimas 24 horas' : `Resumo ${formatarDesde(periodo.desde)}`}</h2>
        {periodo.primeiraVisita && <p className="resumo-sub">Esta é sua primeira visita registrada neste computador, então mostramos as últimas 24 horas.</p>}
      </div>

      {temMomentum && momentum && (
        <div className="resumo-momentum" role="status">
          {momentum.tasksCompletedLast24h > 0 && (
            <span className="resumo-momentum-chip"><CheckCircle2 size={14} />{pluralizar(momentum.tasksCompletedLast24h, 'tarefa concluída', 'tarefas concluídas')} nas últimas 24 horas</span>
          )}
          {momentum.checkpointsLast24h > 0 && (
            <span className="resumo-momentum-chip"><GitCommitHorizontal size={14} />{pluralizar(momentum.checkpointsLast24h, 'checkpoint', 'checkpoints')} nas últimas 24 horas</span>
          )}
          {momentum.streakDays > 0 && (
            <span className="resumo-momentum-chip"><Flame size={14} />{pluralizar(momentum.streakDays, 'dia seguido', 'dias seguidos')} com checkpoint</span>
          )}
        </div>
      )}

      {tudoEmDia && (
        <div className="resumo-tudo-em-dia" role="status">
          <ShieldCheck size={18} />
          <div className="resumo-tudo-em-dia-content">
            <strong>Tudo em dia</strong>
            <p>Nenhum bloqueio aberto nem decisão pendente no momento.</p>
          </div>
        </div>
      )}

      <section className="resumo-secao" aria-label="Ficou pronto">
        <h3><CheckCircle2 size={16} />Ficou pronto</h3>
        {tarefasConcluidas.length === 0 ? (
          <p className="resumo-vazio">Nenhuma tarefa concluída {periodo.primeiraVisita ? 'nas últimas 24 horas' : formatarDesde(periodo.desde)}.</p>
        ) : (
          <ul ref={listaProntoRef} className="resumo-lista-pronto">
            {tarefasConcluidas.map(({ tarefa, registro }) => {
              const frase = registro.humanSummary;
              const confianca = nivelDeConfianca(evidencias.filter(e => e.checkpointId === registro.id));
              return (
                <li key={tarefa.id} className="resumo-item-pronto">
                  <div className="resumo-item-pronto-top">
                    <strong>{tarefa.title}</strong>
                    <DateLabel value={registro.createdAt} />
                  </div>
                  {frase ? <p>{frase}</p> : <ResumoTecnicoItem summary={registro.summary} />}
                  <span className={`resumo-confianca tom-${confianca.tom}`}>{confianca.rotulo}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {temPendentes && (
        <section className="resumo-secao" aria-label="Esperando por você">
          <h3><Hourglass size={16} />Esperando por você</h3>
          <p>{pluralizar(contagemPendentes, 'proposta espera', 'propostas esperam')} sua decisão.</p>
          <button type="button" className="button secondary" onClick={onOpenApprovals}>Ver propostas<ArrowRight size={14} /></button>
        </section>
      )}

      {temTravado && (
        <section className="resumo-secao" aria-label="Travado">
          <h3><Lock size={16} />Travado</h3>
          <ul className="resumo-lista-travado">
            {stalledTasks.map(item => (
              <li key={item.taskId}><strong>{item.taskTitle}</strong><p>{item.reason}</p></li>
            ))}
            {bloqueiosAbertos && bloqueiosAbertos.count > 0 && (
              <li><strong>{pluralizar(bloqueiosAbertos.count, 'bloqueio aberto', 'bloqueios abertos')}</strong><p>{bloqueiosAbertos.reason}</p></li>
            )}
          </ul>
        </section>
      )}

      {temEvidenciasDesatualizadas && evidenciasDesatualizadas && (
        <section className="resumo-secao resumo-reconferir" aria-label="Reconferir evidências">
          <h3><RefreshCw size={16} />Reconferir evidências</h3>
          <div className="resumo-aviso-reconferir">
            <strong>{pluralizar(evidenciasDesatualizadas.count, 'evidência desatualizada', 'evidências desatualizadas')}</strong>
            <p>{evidenciasDesatualizadas.reason}</p>
          </div>
        </section>
      )}

      {proximosPassos.length > 0 && (
        <section className="resumo-secao" aria-label="Sugestões para agora">
          <h3><TrendingUp size={16} />Sugestões para agora</h3>
          <ul className="resumo-lista-proximo">
            {proximosPassos.map(acao => (
              <li key={acao.id}><strong>{acao.title}</strong><p>{acao.reason}</p></li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
