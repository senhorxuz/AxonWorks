import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  FileCheck2,
  Flag,
  GitCommitHorizontal,
  ListTodo,
  AlertTriangle,
  Send,
  Sparkles,
} from 'lucide-react';
import type { Checkpoint, ProjectDetail, Task } from '../shared/types';
import type { Decision, HandoffDelivery, ProjectBlocker } from '../shared/continuity';
import { DateLabel } from './ui';

export interface OperationalChangelogProps {
  detail: ProjectDetail;
  agent: string;
  decisions?: Decision[];
  blockers?: ProjectBlocker[];
  deliveries?: HandoffDelivery[];
}

export function OperationalChangelog({
  detail,
  agent,
  decisions = [],
  blockers = [],
  deliveries = [],
}: OperationalChangelogProps) {
  const [copied, setCopied] = useState(false);

  const checkpoints = useMemo(() => {
    return [...detail.checkpoints].sort((a, b) => b.revision - a.revision);
  }, [detail.checkpoints]);

  const latest = checkpoints[0] as Checkpoint | undefined;
  const previous = checkpoints[1] as Checkpoint | undefined;

  // Time boundary for "what changed since last time"
  const previousCutoff = previous ? new Date(previous.createdAt).getTime() : 0;

  // Tasks completed or created since prior checkpoint
  const completedSincePrior = useMemo(() => {
    return detail.tasks.filter(t => {
      if (t.status !== 'done') return false;
      if (!previousCutoff) return true;
      if (t.completionCheckpointId && latest && t.completionCheckpointId === latest.id) return true;
      return new Date(t.createdAt).getTime() >= previousCutoff;
    });
  }, [detail.tasks, previousCutoff, latest]);

  const activeTasks = useMemo(() => {
    const now = Date.now();
    return detail.tasks.filter(t => t.leaseUntil && new Date(t.leaseUntil).getTime() > now);
  }, [detail.tasks]);

  const newDecisions = useMemo(() => {
    return decisions.filter(d => {
      if (!previousCutoff) return d.status === 'accepted';
      return new Date(d.createdAt).getTime() >= previousCutoff;
    });
  }, [decisions, previousCutoff]);

  const recentBlockers = useMemo(() => {
    return blockers.filter(b => {
      if (!previousCutoff) return b.status === 'open' || b.status === 'mitigated';
      return (
        new Date(b.createdAt).getTime() >= previousCutoff ||
        (b.resolvedAt ? new Date(b.resolvedAt).getTime() >= previousCutoff : false)
      );
    });
  }, [blockers, previousCutoff]);

  const recentDeliveries = useMemo(() => {
    return deliveries.filter(del => {
      if (!previousCutoff) return true;
      return new Date(del.createdAt).getTime() >= previousCutoff;
    });
  }, [deliveries, previousCutoff]);

  // Generate markdown changelog for clipboard
  const markdownChangelog = useMemo(() => {
    const lines: string[] = [];
    const revLabel = latest ? `r${latest.revision}` : 'r0';
    const prevLabel = previous ? `r${previous.revision}` : 'início';

    lines.push(`# O que mudou desde a última vez (${prevLabel} → ${revLabel})`);
    lines.push(`Projeto: ${detail.project.name} | Gerado em: ${new Date().toLocaleString('pt-BR')}`);
    lines.push('');

    if (latest) {
      lines.push(`## Ponto de Retomada Atual (${latest.agent})`);
      lines.push(`- **Sumário**: ${latest.summary}`);
      lines.push(`- **Próximo Passo**: ${latest.nextStep}`);
      lines.push('');
    }

    if (completedSincePrior.length > 0) {
      lines.push('## Tarefas Concluídas');
      for (const t of completedSincePrior) {
        lines.push(`- [x] ${t.title}`);
      }
      lines.push('');
    }

    if (newDecisions.length > 0) {
      lines.push('## Decisões Registradas');
      for (const d of newDecisions) {
        lines.push(`- **${d.title}** (${d.status}): ${d.body}`);
      }
      lines.push('');
    }

    if (recentBlockers.length > 0) {
      lines.push('## Bloqueios e Incertezas');
      for (const b of recentBlockers) {
        lines.push(`- [${b.status}] ${b.title}: ${b.body}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }, [detail, latest, previous, completedSincePrior, newDecisions, recentBlockers]);

  async function copyChangelog() {
    try {
      await navigator.clipboard.writeText(markdownChangelog);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  }

  if (checkpoints.length === 0) {
    return (
      <section className="panel changelog-panel" aria-label="O que mudou desde a última vez">
        <div className="panel-heading">
          <div className="eyebrow">
            <Clock size={14} />
            <span>LINHA DO TEMPO OPERACIONAL</span>
          </div>
          <span className="mono-label">O QUE MUDOU</span>
        </div>
        <p className="subtle-text">
          O histórico de mudanças começará assim que o primeiro checkpoint for salvo.
        </p>
      </section>
    );
  }

  return (
    <section className="panel changelog-panel" aria-label="O que mudou desde a última vez">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">
            <Sparkles size={14} />
            <span>O QUE MUDOU</span>
          </div>
          <h2>O que mudou desde a última vez</h2>
          <p className="subtle-text">
            {previous ? `Desde a versão ${previous.revision}` : 'Desde o início'}
          </p>
        </div>
        <div className="changelog-header-actions">
          <button
            type="button"
            className="button secondary small-btn"
            onClick={() => void copyChangelog()}
            title="Copiar relatório em Markdown para passar a outro agente"
          >
            {copied ? <CheckCircle2 size={13} className="text-ok" /> : <Copy size={13} />}
            <span>{copied ? 'Copiado!' : 'Copiar Mudanças'}</span>
          </button>
        </div>
      </div>

      {/* Change highlights grid */}
      <div className="changelog-grid">
        {/* Box 1: Progresso de Tarefas */}
        <div className="changelog-card">
          <div className="changelog-card-header">
            <FileCheck2 size={15} />
            <h4>Tarefas e Entregas</h4>
            <span className="count-badge">{completedSincePrior.length} concluídas</span>
          </div>
          {completedSincePrior.length === 0 ? (
            <p className="changelog-subtle">Nenhuma tarefa finalizada no ciclo mais recente.</p>
          ) : (
            <ul className="changelog-list">
              {completedSincePrior.map(t => (
                <li key={t.id} className="changelog-item">
                  <CheckCircle2 size={13} className="text-ok" />
                  <div>
                    <strong>{t.title}</strong>
                    {t.priority && t.priority !== 'medium' && (
                      <span className={`task-priority-badge priority-${t.priority}`}>
                        {t.priority}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {activeTasks.length > 0 && (
            <div className="changelog-footer-note">
              <ListTodo size={12} />
              <span>{activeTasks.length} tarefa(s) em execução ativa</span>
            </div>
          )}
        </div>

        {/* Box 2: Decisões Canônicas Recentes */}
        <div className="changelog-card">
          <div className="changelog-card-header">
            <Flag size={15} />
            <h4>Diretrizes & Decisões</h4>
            <span className="count-badge">{newDecisions.length}</span>
          </div>
          {newDecisions.length === 0 ? (
            <p className="changelog-subtle">Nenhuma nova decisão formulada neste intervalo.</p>
          ) : (
            <ul className="changelog-list">
              {newDecisions.map(d => (
                <li key={d.id} className="changelog-item">
                  <span className={`status-tag decision-tag-${d.status}`}>
                    {d.status === 'accepted' ? 'Vigente' : d.status === 'proposed' ? 'Proposta' : d.status}
                  </span>
                  <div>
                    <strong>{d.title}</strong>
                    <p className="changelog-item-snippet">{d.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Box 3: Bloqueios e Passagens */}
        <div className="changelog-card">
          <div className="changelog-card-header">
            <AlertTriangle size={15} />
            <h4>Bloqueios & Passagens</h4>
            <span className="count-badge">{recentBlockers.length + recentDeliveries.length}</span>
          </div>
          {recentBlockers.length === 0 && recentDeliveries.length === 0 ? (
            <p className="changelog-subtle">Sem bloqueios pendentes ou passagens não lidas.</p>
          ) : (
            <ul className="changelog-list">
              {recentBlockers.map(b => (
                <li key={b.id} className="changelog-item">
                  <span className={`status-tag ${b.status === 'resolved' ? 'neutral' : 'alert-tag'}`}>
                    {b.status === 'resolved' ? 'Resolvido' : 'Bloqueio'}
                  </span>
                  <div>
                    <strong>{b.title}</strong>
                    {b.assignee && <small> · Resp: {b.assignee}</small>}
                  </div>
                </li>
              ))}
              {recentDeliveries.map(del => (
                <li key={del.id} className="changelog-item">
                  <Send size={12} />
                  <div>
                    <strong>Passagem de {del.from} → {del.to}</strong>
                    <small>versão {del.checkpoint.revision}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
