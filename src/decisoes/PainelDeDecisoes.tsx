import { useEffect, useId, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Flag, Hourglass, Plus, RefreshCw } from 'lucide-react';
import type { Decision } from '../../shared/continuity';
import { DecisionTimelineDialog } from '../dialogs';
import { CHAVE_DAS_DECISOES_ESPERANDO, chaveDaChegada } from '../chegada/chegada';
import { DateLabel, EmptyNote } from '../ui';
import { rotuloDoHistorico, separarDecisoes } from './separar';
import './decisoes.css';

const ROTULO_DO_STATUS: Record<Decision['status'], { texto: string; classe: string }> = {
  accepted: { texto: 'Vigente', classe: 'decision-tag-accepted' },
  proposed: { texto: 'Proposta', classe: 'decision-tag-proposed' },
  superseded: { texto: 'Substituída', classe: 'decision-tag-superseded' },
  revoked: { texto: 'Revogada', classe: 'decision-tag-revoked' },
};

function CartaoDeDecisao({ decisao, aoVerLinhaDoTempo, aoAceitar, aoRevogar, aoSubstituir }: {
  decisao: Decision;
  aoVerLinhaDoTempo: (decisao: Decision) => void;
  aoAceitar: (decisao: Decision) => void;
  aoRevogar: (decisao: Decision) => void;
  aoSubstituir: (decisao: Decision) => void;
}) {
  const { texto, classe } = ROTULO_DO_STATUS[decisao.status];
  const proposta = decisao.status === 'proposed';
  const vigente = decisao.status === 'accepted';
  return (
    <article data-chegada={chaveDaChegada('decisao', decisao.id)} className={`decision-card ${decisao.status === 'superseded' ? 'is-superseded' : ''} ${decisao.status === 'revoked' ? 'is-revoked' : ''}`}>
      <div className="decision-card-head">
        <span className={`status-tag ${classe}`}>{texto}</span>
        <span className="revision-badge">v{decisao.version}</span>
        {decisao.source?.kind === 'human_directive' && <span className="status-tag neutral">Diretiva humana</span>}
        <DateLabel value={decisao.createdAt} />
      </div>
      <h3>{decisao.title}</h3>
      <p className="decision-card-body">{decisao.body}</p>
      <div className="decision-card-meta">
        <span>Proposta por <strong>{decisao.proposedBy}</strong></span>
        {decisao.acceptedBy && <span> · Aceita por <strong>{decisao.acceptedBy}</strong></span>}
        {decisao.revokedBy && <span> · Revogada por <strong>{decisao.revokedBy}</strong></span>}
        {decisao.supersedesId && <span> · Substitui decisão anterior</span>}
        {decisao.supersededById && <span> · Substituída por nova versão</span>}
        {decisao.source?.note && <small className="decision-note">({decisao.source.note})</small>}
      </div>
      <div className="decision-card-actions">
        <button type="button" className="button ghost" onClick={() => aoVerLinhaDoTempo(decisao)}>Linha do tempo</button>
        {proposta && <button type="button" className="button primary" onClick={() => aoAceitar(decisao)}><Check size={14} />Aceitar decisão</button>}
        {vigente && <>
          <button type="button" className="button secondary" onClick={() => aoSubstituir(decisao)}>Substituir</button>
          <button type="button" className="button ghost" onClick={() => aoRevogar(decisao)}>Revogar</button>
        </>}
      </div>
    </article>
  );
}

function Bloco({ titulo, quantidade, icone, destaque, chegada, children }: { titulo: string; quantidade: number; icone?: ReactNode; destaque?: boolean; chegada?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={`decisoes-bloco${destaque ? ' pede-voce' : ''}`} aria-labelledby={id} data-chegada={chegada}>
      <h3 id={id}>{icone}{titulo}<span className="count-badge">{quantidade}</span></h3>
      <div className="decision-list">{children}</div>
    </section>
  );
}

/**
 * Aba Decisões. As propostas abertas pedem o dono e ficam sempre no topo, em "Esperando você aceitar".
 * O histórico é só o que já saiu de cena (revogadas e substituídas) e abre por um botão.
 */
export function PainelDeDecisoes({ projectId, abrirHistoricoPara, aoAtenderHistorico, decisions, loading, error, onPropose, onAccept, onRevoke, onSupersede, onReload }: {
  projectId: string;
  /** Decisão que o dono veio ver (de Relações): se já saiu de cena, o histórico abre sozinho. */
  abrirHistoricoPara?: string | null;
  /** Avisa que o pedido acima já foi atendido (a decisão chegou na lista): quem pediu pode esquecê-lo. */
  aoAtenderHistorico?: () => void;
  decisions: Decision[];
  loading: boolean;
  error: string;
  onPropose: () => void;
  onAccept: (decisao: Decision) => void;
  onRevoke: (decisao: Decision) => void;
  onSupersede: (decisao: Decision) => void;
  onReload: () => Promise<void>;
}) {
  const [linhaDoTempo, setLinhaDoTempo] = useState<Decision | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const { abertas, vigentes, historico } = separarDecisoes(decisions);
  const noHistorico = abrirHistoricoPara ? historico.some(decisao => decisao.id === abrirHistoricoPara) : false;
  const chegou = abrirHistoricoPara ? decisions.some(decisao => decisao.id === abrirHistoricoPara) : false;
  useEffect(() => {
    if (noHistorico) setHistoricoAberto(true);
    if (chegou) aoAtenderHistorico?.();
  }, [noHistorico, chegou, abrirHistoricoPara]);
  const cartao = (decisao: Decision) => (
    <CartaoDeDecisao key={decisao.id} decisao={decisao} aoVerLinhaDoTempo={setLinhaDoTempo} aoAceitar={onAccept} aoRevogar={onRevoke} aoSubstituir={onSupersede} />
  );
  const vazio = !loading && decisions.length === 0;
  return (
    <section className="decisions-panel" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <h2>Decisões canônicas</h2>
          <p>Diretrizes e escolhas arquiteturais. Decisões vigentes orientam as IAs nos briefings de continuidade.</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="button primary" onClick={onPropose}><Plus size={16} />Propor decisão</button>
        </div>
      </div>

      {loading && decisions.length === 0 && <div className="loading" role="status"><RefreshCw size={17} />Consultando decisões…</div>}

      {error && <div className="alert" role="alert"><span>{error}</span><button type="button" onClick={() => void onReload()}>Tentar novamente</button></div>}

      {vazio ? (
        <EmptyNote>
          <Flag size={25} />
          <p>
            Nenhuma decisão registrada neste projeto.
            <br />
            <span>Uma decisão proposta por IA só tem valor canônico após ser aceita pelo operador humano.</span>
          </p>
          <button type="button" className="text-button" onClick={onPropose}>Propor primeira decisão<ArrowRight size={14} /></button>
        </EmptyNote>
      ) : (
        <>
          {abertas.length > 0 && <Bloco titulo="Esperando você aceitar" quantidade={abertas.length} icone={<Hourglass size={15} />} destaque chegada={CHAVE_DAS_DECISOES_ESPERANDO}>{abertas.map(cartao)}</Bloco>}
          {vigentes.length > 0
            ? <Bloco titulo="Vigentes" quantidade={vigentes.length}>{vigentes.map(cartao)}</Bloco>
            : !loading && <p className="decisoes-sem-vigentes">Nenhuma decisão vigente no momento.{abertas.length > 0 && ' Aceite uma proposta acima para ela valer.'}</p>}
          {historico.length > 0 && (
            <div className="decisoes-historico">
              <button type="button" className="button secondary" aria-expanded={historicoAberto} onClick={() => setHistoricoAberto(aberto => !aberto)}>
                {rotuloDoHistorico(historicoAberto, historico.length)}
              </button>
              {historicoAberto && <div className="decision-list">{historico.map(cartao)}</div>}
            </div>
          )}
        </>
      )}
      {linhaDoTempo && <DecisionTimelineDialog projectId={projectId} decision={linhaDoTempo} onClose={() => setLinhaDoTempo(null)} />}
    </section>
  );
}
