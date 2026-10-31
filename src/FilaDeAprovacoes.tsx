import { useCallback, useEffect, useRef, useState } from 'react';
import { Hourglass, ThumbsUp, XCircle } from 'lucide-react';
import type { ApprovalRequest } from '../shared/approvals';
import type { CharterRevision } from '../shared/continuity';
import { ApiError, api, errorText, request } from './api';
import './painel.css';

/**
 * Parte 5 (tela) e Parte 13 — Esperando por você e Comemorações ao vivo.
 *
 * Para apagar esta parte: remova este arquivo e a linha de montagem
 * <FilaDeAprovacoes> em src/Workspace.tsx.
 *
 * Quem decide é o DONO do projeto, não a IA declarada na barra lateral — por
 * isso o nome usado aqui vem de um campo próprio, guardado localmente.
 *
 * Parte 13: Ao confirmar a decisão no servidor, exibe linha de confirmação por
 * 3 segundos com a frase exata no lugar onde a proposta estava. Se a lista
 * ficar vazia, a seção continua visível enquanto a confirmação existir.
 */

const CHAVE_NOME_DONO = 'axon-nome-do-dono';

export interface ConfirmacaoDecisao {
  id: string;
  tipo: 'aprovada' | 'recusada';
  mensagem: string;
}

type ItemFila =
  | { tipo: 'pendente'; approval: ApprovalRequest }
  | { tipo: 'confirmada'; confirmacao: ConfirmacaoDecisao };

function mensagemDeErro(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'charter_revision_conflict') return 'A diretriz mudou desde que esta proposta foi lida. Releia a diretriz atual abaixo e decida de novo.';
    if (err.code === 'approval_not_pending') return 'Esta proposta já foi decidida por outra pessoa; a lista foi atualizada.';
    if (err.code === 'version_conflict') return 'Esta proposta mudou enquanto você decidia; a lista foi atualizada.';
  }
  return errorText(err);
}

function ehConflito(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

export function FilaDeAprovacoes(props: {
  projectId: string;
  /** O Workspace recarrega o projeto: a diretriz pode ter mudado. */
  onDecided: () => void;
}) {
  const { projectId, onDecided } = props;
  const [itens, setItens] = useState<ItemFila[] | undefined>(undefined);
  const [charter, setCharter] = useState<CharterRevision | null | undefined>(undefined);
  const [erro, setErro] = useState('');
  const [nomeDono, setNomeDono] = useState(() => {
    try { return localStorage.getItem(CHAVE_NOME_DONO) || ''; } catch { return ''; }
  });
  const [editandoNome, setEditandoNome] = useState(() => {
    try { return !localStorage.getItem(CHAVE_NOME_DONO); } catch { return true; }
  });
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const carregar = useCallback(async (signal?: AbortSignal) => {
    try {
      const [lista, diretrizAtual] = await Promise.all([
        request<ApprovalRequest[]>(`/projects/${projectId}/approvals?status=pending`, undefined, signal, 'GET'),
        api.charter(projectId, signal),
      ]);
      if (signal?.aborted) return;
      setItens(prev => {
        if (!prev) {
          return lista.map(approval => ({ tipo: 'pendente' as const, approval }));
        }
        const mapaNovos = new Map(lista.map(a => [a.id, a]));
        const resultado: ItemFila[] = [];
        const vistos = new Set<string>();

        for (const item of prev) {
          if (item.tipo === 'confirmada') {
            resultado.push(item);
            vistos.add(item.confirmacao.id);
          } else {
            const atualizado = mapaNovos.get(item.approval.id);
            if (atualizado) {
              resultado.push({ tipo: 'pendente', approval: atualizado });
              vistos.add(atualizado.id);
            }
          }
        }

        for (const a of lista) {
          if (!vistos.has(a.id)) {
            resultado.push({ tipo: 'pendente', approval: a });
          }
        }

        return resultado;
      });
      setCharter(diretrizAtual);
      setErro('');
    } catch (err) {
      if (signal?.aborted) return;
      setErro(errorText(err));
    }
  }, [projectId]);

  const atualizarTudo = useCallback(async () => {
    await carregar();
    onDecided();
  }, [carregar, onDecided]);

  const handleDecidido = useCallback((decisao: ConfirmacaoDecisao) => {
    setItens(prev => {
      if (!prev) return prev;
      return prev.map(item => {
        if (item.tipo === 'pendente' && item.approval.id === decisao.id) {
          return { tipo: 'confirmada', confirmacao: decisao };
        }
        return item;
      });
    });

    const timer = setTimeout(() => {
      setItens(prev => prev?.filter(item => !(item.tipo === 'confirmada' && item.confirmacao.id === decisao.id)));
      timersRef.current.delete(decisao.id);
    }, 3000);
    timersRef.current.set(decisao.id, timer);

    void atualizarTudo();
  }, [atualizarTudo]);

  useEffect(() => {
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current.clear();
    setItens(undefined);
    const controller = new AbortController();
    void carregar(controller.signal);
    return () => {
      controller.abort();
      timersRef.current.forEach(t => clearTimeout(t));
      timersRef.current.clear();
    };
  }, [projectId, carregar]);

  function salvarNomeDono(valor: string) {
    const limpo = valor.trim();
    setNomeDono(limpo);
    if (limpo) setEditandoNome(false);
    try { localStorage.setItem(CHAVE_NOME_DONO, limpo); } catch { /* Preferência não é essencial. */ }
  }

  const semConteudo = !erro && (itens === undefined || itens.length === 0);
  if (semConteudo) return null;

  const temPendentes = itens && itens.some(i => i.tipo === 'pendente');

  return (
    <section id="fila-de-aprovacoes" className="fila-de-aprovacoes" aria-label="Esperando por você">
      <div className="resumo-header">
        <span className="eyebrow"><Hourglass size={15} />ESPERANDO POR VOCÊ</span>
        <h2>Propostas para decidir</h2>
      </div>
      {erro && <div className="alert" role="alert">{erro}</div>}
      {temPendentes && (
        <div className="fila-identidade">
          {editandoNome ? (
            <form onSubmit={event => { event.preventDefault(); const valor = new FormData(event.currentTarget).get('nome-dono'); salvarNomeDono(typeof valor === 'string' ? valor : ''); }}>
              <label htmlFor="fila-nome-dono">Seu nome, para registrar decisões</label>
              <div className="fila-identidade-campo">
                <input id="fila-nome-dono" name="nome-dono" defaultValue={nomeDono} required maxLength={80} placeholder="Como você quer ser identificado?" />
                <button type="submit" className="button secondary">Salvar nome</button>
              </div>
            </form>
          ) : (
            <p className="fila-identidade-atual">Decidindo como <strong>{nomeDono}</strong> · <button type="button" className="text-button" onClick={() => setEditandoNome(true)}>Trocar nome</button></p>
          )}
        </div>
      )}
      <div className="fila-lista">
        {itens && itens.map(item => {
          if (item.tipo === 'confirmada') {
            const conf = item.confirmacao;
            const isAprovada = conf.tipo === 'aprovada';
            return (
              <div
                key={conf.id}
                role="status"
                className="fila-confirmacao-decidida"
                {...(isAprovada ? { 'data-comemoracao': 'aprovada' } : {})}
              >
                {isAprovada && (
                  <svg
                    className="fila-confirmacao-check"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span>{conf.mensagem}</span>
              </div>
            );
          }
          return (
            <PropostaCard
              key={item.approval.id}
              approval={item.approval}
              charterAtual={charter ?? null}
              nomeDono={nomeDono}
              projectId={projectId}
              onAtualizar={() => void atualizarTudo()}
              onDecidido={handleDecidido}
            />
          );
        })}
      </div>
    </section>
  );
}

function PropostaCard({ approval, charterAtual, nomeDono, projectId, onAtualizar, onDecidido }: {
  approval: ApprovalRequest;
  charterAtual: CharterRevision | null;
  nomeDono: string;
  projectId: string;
  onAtualizar: () => void;
  onDecidido: (decisao: ConfirmacaoDecisao) => void;
}) {
  const [modo, setModo] = useState<'idle' | 'confirmar-aprovar' | 'confirmar-recusar'>('idle');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const objeto = approval.kind === 'charter_change' ? 'diretriz' : 'nota';

  async function aprovar() {
    setBusy(true);
    setErro('');
    try {
      const body: Record<string, unknown> = { actor: nomeDono, expectedVersion: approval.version };
      if (approval.kind === 'charter_change') body.expectedCharterRevision = charterAtual ? charterAtual.revision : 0;
      await request(`/projects/${projectId}/approvals/${approval.id}/approve`, body);
      setModo('idle');
      onDecidido({
        id: approval.id,
        tipo: 'aprovada',
        mensagem: approval.kind === 'charter_change'
          ? 'Diretriz aprovada. Ela já vale para todas as IAs.'
          : 'Nota aprovada.',
      });
    } catch (err) {
      setErro(mensagemDeErro(err));
      if (ehConflito(err)) onAtualizar();
    } finally {
      setBusy(false);
    }
  }

  async function recusar() {
    if (!motivo.trim()) return;
    setBusy(true);
    setErro('');
    try {
      await request(`/projects/${projectId}/approvals/${approval.id}/reject`, {
        actor: nomeDono,
        expectedVersion: approval.version,
        decisionNote: motivo.trim(),
      });
      setModo('idle');
      setMotivo('');
      onDecidido({
        id: approval.id,
        tipo: 'recusada',
        mensagem: 'Proposta recusada. O motivo ficou registrado.',
      });
    } catch (err) {
      setErro(mensagemDeErro(err));
      if (ehConflito(err)) onAtualizar();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="fila-card">
      <div className="fila-card-top">
        <span className="eyebrow">{approval.kind === 'charter_change' ? 'MUDANÇA DE DIRETRIZ' : 'NOTA'}</span>
        <span className="fila-proposto-por">Proposto por {approval.proposedBy}</span>
      </div>
      <h3>{approval.title}</h3>
      <p className="fila-motivo"><strong>Motivo:</strong> {approval.rationale}</p>

      {approval.kind === 'charter_change' ? (
        <div className="fila-comparacao">
          <div>
            <span className="fila-comparacao-rotulo">Diretriz atual</span>
            <p>{charterAtual?.body || 'Nenhuma diretriz definida ainda.'}</p>
          </div>
          <div>
            <span className="fila-comparacao-rotulo">Diretriz proposta</span>
            <p>{approval.body}</p>
          </div>
        </div>
      ) : (
        <div className="fila-comparacao fila-comparacao-simples">
          <div>
            <span className="fila-comparacao-rotulo">Conteúdo proposto</span>
            <p>{approval.body}</p>
          </div>
        </div>
      )}

      {modo === 'idle' && (
        <div className="fila-card-acoes">
          <button type="button" className="button primary" disabled={!nomeDono.trim()} title={!nomeDono.trim() ? 'Informe seu nome acima para decidir.' : undefined} onClick={() => setModo('confirmar-aprovar')}>
            {approval.kind === 'charter_change' ? 'Aprovar diretriz' : 'Aprovar nota'}<ThumbsUp size={14} />
          </button>
          <button type="button" className="button secondary" disabled={!nomeDono.trim()} title={!nomeDono.trim() ? 'Informe seu nome acima para decidir.' : undefined} onClick={() => setModo('confirmar-recusar')}>
            Recusar proposta<XCircle size={14} />
          </button>
        </div>
      )}

      {modo === 'confirmar-aprovar' && (
        <div className="fila-confirmacao" role="alertdialog" aria-label={`Confirmar aprovação de ${objeto}`}>
          <p>{approval.kind === 'charter_change' ? 'A nova diretriz passa a valer para todas as IAs.' : 'Esta nota fica marcada como aprovada e visível no histórico.'}</p>
          {erro && <div className="alert" role="alert">{erro}</div>}
          <div className="fila-confirmacao-acoes">
            <button type="button" className="button ghost" disabled={busy} onClick={() => { setModo('idle'); setErro(''); }}>Cancelar</button>
            <button type="button" className="button primary" disabled={busy} onClick={() => void aprovar()}>{busy ? 'Aprovando…' : (approval.kind === 'charter_change' ? 'Aprovar diretriz' : 'Aprovar nota')}</button>
          </div>
        </div>
      )}

      {modo === 'confirmar-recusar' && (
        <form className="fila-confirmacao" onSubmit={event => { event.preventDefault(); void recusar(); }}>
          <label htmlFor={'fila-motivo-' + approval.id}>Motivo da recusa</label>
          <textarea id={'fila-motivo-' + approval.id} value={motivo} onChange={event => setMotivo(event.target.value)} required rows={3} maxLength={2000} placeholder="Explique por que esta proposta não deve seguir." autoFocus />
          {erro && <div className="alert" role="alert">{erro}</div>}
          <div className="fila-confirmacao-acoes">
            <button type="button" className="button ghost" disabled={busy} onClick={() => { setModo('idle'); setErro(''); setMotivo(''); }}>Cancelar</button>
            <button type="submit" className="button primary" disabled={busy || !motivo.trim()}>{busy ? 'Recusando…' : 'Recusar proposta'}</button>
          </div>
        </form>
      )}
    </article>
  );
}
