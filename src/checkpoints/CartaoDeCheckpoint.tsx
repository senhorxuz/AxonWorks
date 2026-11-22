import { useId, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, HelpCircle, Send } from 'lucide-react';
import type { Checkpoint, EvidenceView } from '../../shared/types';
import { BotoesDeApagar } from '../apagar/BotoesDeApagar';
import { DateLabel } from '../ui';
import { evidenciasDoRegistro, rotuloDoDetalhe } from './evidencias';
import './checkpoints.css';

function EvidenciaDoRegistro({ ev, aoConferir }: { ev: EvidenceView; aoConferir?: (evidence: EvidenceView) => void }) {
  const isStale = ev.freshness === 'stale';
  const isMissing = ev.freshness === 'missing';
  const isUnverifiable = ev.freshness === 'unverifiable';
  const hasWarning = isStale || isMissing || isUnverifiable;

  return (
    <div
      className={`evidence ${isStale ? 'evidence-stale' : ''} ${hasWarning ? 'has-warning' : ''}`}
    >
      <div className="evidence-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '10px', flexWrap: 'wrap' }}>
        <div className="evidence-assertions" style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="status-tag neutral assertion-tag">Informado pela IA</span>
          {(ev.assertions?.includes('cross_checked') || (ev.verifications && ev.verifications.length > 0)) && (
            <span className="status-tag neutral assertion-tag">
              Conferido por outra IA ({ev.verifications?.length || 1})
            </span>
          )}
          {ev.assertions?.includes('artifact_bound') && (
            <span className="status-tag neutral assertion-tag">
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

      {aoConferir && (
        <div className="evidence-actions" style={{ marginTop: '10px', width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="button secondary cross-check-btn"
            style={{ padding: '6px 10px', minHeight: '28px' }}
            onClick={() => aoConferir(ev)}
            title="Conferir este teste com outra identidade declarada"
          >
            <CheckCircle2 size={13} />
            Conferir evidência
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Um checkpoint. Fechado, ocupa três linhas: quem e quando, o resumo e o próximo passo (cada um cortado
 * em poucas linhas). Decisões, bloqueios, evidências e as ações abrem com um clique.
 */
export function CartaoDeCheckpoint({ checkpoint: cp, agent, evidenceViews = [], onDeliver, onCrossCheck, onApagado }: {
  checkpoint: Checkpoint;
  agent: string;
  evidenceViews?: EvidenceView[];
  onDeliver: (checkpoint: Checkpoint) => void;
  onCrossCheck?: (evidence: EvidenceView) => void;
  onApagado: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const idDoDetalhe = useId();
  const mine = Boolean(agent) && cp.agent === agent;
  const evidencias = evidenciasDoRegistro(cp, evidenceViews);

  return (
    <article className={`checkpoint-card${aberto ? ' is-aberto' : ''}`}>
      <div className="checkpoint-meta">
        <span className="revision-badge">versão {cp.revision}</span>
        <strong>{cp.agent}</strong>
        <DateLabel value={cp.createdAt} />
      </div>
      <h3 className="checkpoint-resumo">{cp.summary}</h3>
      <div className="checkpoint-next">
        <ArrowRight size={16} />
        <div>
          <span>PRÓXIMO PASSO</span>
          <p>{cp.nextStep}</p>
        </div>
      </div>
      <button type="button" className="text-button checkpoint-alternar" aria-expanded={aberto} aria-controls={idDoDetalhe} onClick={() => setAberto(valor => !valor)}>
        <ChevronDown size={14} aria-hidden="true" />{rotuloDoDetalhe(aberto, evidencias.length)}
      </button>
      <div id={idDoDetalhe} hidden={!aberto} className="checkpoint-detalhe">
        {aberto && <>
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
          {evidencias.map((ev, i) => <EvidenciaDoRegistro key={ev.id || i} ev={ev} aoConferir={onCrossCheck} />)}
          {mine && (
            <div className="checkpoint-actions">
              <button className="button secondary" onClick={() => onDeliver(cp)}>
                <Send size={15} />
                Entregar para outra IA
              </button>
            </div>
          )}
          <BotoesDeApagar projectId={cp.projectId} checkpointId={cp.id} onApagado={onApagado} />
        </>}
      </div>
    </article>
  );
}
