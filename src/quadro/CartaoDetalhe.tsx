import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { BOARD_COLUMNS, BOARD_LABELS, BOARD_LIMITS, type BoardCard, type BoardCardEvent, type BoardColumnId, type BoardLabelId, type BoardPriority, type UpdateBoardCardInput } from '../../shared/board';
import { ApiError, errorText } from '../api';
import { gsap } from '../motion';
import { apiQuadro, nomeDoDono } from './api-quadro';
import { corDoNome, inicial, tempoRelativo } from './logica';

const PRIORIDADES: Array<{ id: BoardPriority | null; nome: string }> = [
  { id: null, nome: 'Sem' },
  { id: 'low', nome: 'Baixa' },
  { id: 'medium', nome: 'Média' },
  { id: 'high', nome: 'Alta' },
  { id: 'urgent', nome: 'Urgente' },
];

type Mudanca = Omit<UpdateBoardCardInput, 'actor' | 'expectedVersion'>;

/**
 * Painel lateral do cartão. Cada campo salva sozinho ao sair dele (ou ao clicar),
 * em fila, sempre com a versão mais nova, para duas mudanças rápidas não brigarem.
 */
export function CartaoDetalhe({ projectId, cartao, corDaColuna, onFechar, onAtualizado, onMover, onExcluido, onConflito }: {
  projectId: string;
  cartao: BoardCard;
  corDaColuna: string;
  onFechar: () => void;
  onAtualizado: (cartao: BoardCard) => void;
  onMover: (coluna: BoardColumnId) => Promise<void> | void;
  onExcluido: () => void;
  onConflito: () => void;
}) {
  const painel = useRef<HTMLDialogElement>(null);
  const retornoDeFoco = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const versao = useRef(cartao.version);
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  const [titulo, setTitulo] = useState(cartao.title);
  const [descricao, setDescricao] = useState(cartao.description);
  const [novoItem, setNovoItem] = useState('');
  const [erroTitulo, setErroTitulo] = useState('');
  const [erro, setErro] = useState('');
  const [salvo, setSalvo] = useState(false);
  const [historico, setHistorico] = useState<BoardCardEvent[] | undefined>(undefined);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const agora = new Date();

  // Versão sempre a mais nova que a tela conhece (inclusive quando o quadro atualiza ao vivo).
  useEffect(() => { versao.current = Math.max(versao.current, cartao.version); }, [cartao.version]);
  // Outro cartão aberto: rascunhos recomeçam.
  useEffect(() => {
    setTitulo(cartao.title);
    setDescricao(cartao.description);
    setErroTitulo('');
    setConfirmandoExclusao(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartao.id]);

  const carregarHistorico = useCallback(async () => {
    try {
      setHistorico(await apiQuadro.historico(projectId, cartao.id));
    } catch {
      setHistorico(undefined);
    }
  }, [projectId, cartao.id]);

  useEffect(() => { void carregarHistorico(); }, [carregarHistorico, cartao.version]);

  useLayoutEffect(() => {
    const elemento = painel.current!;
    if (!elemento.open) elemento.showModal();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(elemento, { xPercent: 6, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.34, ease: 'power4.out', clearProps: 'transform,opacity,visibility' });
    }
    const voltar = retornoDeFoco.current;
    return () => { voltar?.focus?.(); };
  }, []);

  const salvar = useCallback((mudanca: Mudanca) => {
    fila.current = fila.current.then(async () => {
      try {
        const atualizado = await apiQuadro.atualizar(projectId, cartao.id, { actor: nomeDoDono(), expectedVersion: versao.current, ...mudanca });
        versao.current = atualizado.version;
        onAtualizado(atualizado);
        setErro('');
        setSalvo(true);
        window.setTimeout(() => setSalvo(false), 1600);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setErro('Este cartão mudou enquanto você mexia. Recarregamos a versão atual.');
          onConflito();
        } else if (err instanceof ApiError && err.code === 'board_title_too_long') {
          setErroTitulo(err.message);
        } else {
          setErro(errorText(err));
        }
      }
    });
    return fila.current;
  }, [projectId, cartao.id, onAtualizado, onConflito]);

  const salvarTitulo = () => {
    const limpo = titulo.trim();
    if (limpo === cartao.title) return;
    if (limpo.length < BOARD_LIMITS.titleMin) {
      setErroTitulo(`Use pelo menos ${BOARD_LIMITS.titleMin} caracteres no título.`);
      return;
    }
    setErroTitulo('');
    void salvar({ title: limpo });
  };

  const alternarEtiqueta = (id: BoardLabelId) => {
    const tem = cartao.labels.includes(id);
    if (!tem && cartao.labels.length >= BOARD_LIMITS.labelsMax) return;
    void salvar({ labels: tem ? cartao.labels.filter(l => l !== id) : [...cartao.labels, id] });
  };

  const checklistComo = (itens: BoardCard['checklist']) => itens.map(i => ({ id: i.id, text: i.text, done: i.done }));

  const alternarItem = (id: string) => {
    void salvar({ checklist: checklistComo(cartao.checklist.map(i => (i.id === id ? { ...i, done: !i.done } : i))) });
  };

  const adicionarItem = () => {
    const texto = novoItem.trim();
    if (!texto || cartao.checklist.length >= BOARD_LIMITS.checklistMax) return;
    setNovoItem('');
    void salvar({ checklist: [...checklistComo(cartao.checklist), { text: texto, done: false }] });
  };

  const tirarItem = (id: string) => {
    void salvar({ checklist: checklistComo(cartao.checklist.filter(i => i.id !== id)) });
  };

  const excluir = async () => {
    try {
      await fila.current;
      await apiQuadro.excluir(projectId, cartao.id, { actor: nomeDoDono(), expectedVersion: versao.current });
      painel.current?.close();
      onExcluido();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setErro('Este cartão mudou enquanto você decidia. Confira a versão atual antes de excluir.');
        onConflito();
      } else {
        setErro(errorText(err));
      }
      setConfirmandoExclusao(false);
    }
  };

  const fechar = () => {
    painel.current?.close();
    onFechar();
  };

  const feitos = cartao.checklist.filter(i => i.done).length;
  const total = cartao.checklist.length;
  const coluna = BOARD_COLUMNS.find(c => c.id === cartao.column)!;

  return (
    <dialog
      ref={painel}
      className="quadro-painel"
      aria-label={`Cartão: ${cartao.title}`}
      style={{ '--cor-coluna': corDaColuna } as CSSProperties}
      onCancel={e => { e.preventDefault(); fechar(); }}
      onClick={e => { if (e.target === painel.current) fechar(); }}
    >
      <div className="quadro-painel-corpo">
        <header className="quadro-painel-topo">
          <span className="quadro-painel-coluna"><span className="quadro-coluna-ponto" aria-hidden="true" />{coluna.name}</span>
          <label className="quadro-painel-mover">
            <span>Mover para</span>
            <select value={cartao.column} onChange={e => void onMover(e.target.value as BoardColumnId)}>
              {BOARD_COLUMNS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {salvo && <span className="quadro-painel-salvo" role="status"><Check size={14} />Salvo</span>}
          <button type="button" className="icon-button" aria-label="Fechar cartão" onClick={fechar}><X size={17} strokeWidth={1.6} /></button>
        </header>

        {erro && <div className="alert" role="alert">{erro}</div>}

        <label className="quadro-painel-rotulo" htmlFor="quadro-painel-titulo">Título</label>
        <textarea
          id="quadro-painel-titulo"
          className="quadro-painel-titulo"
          value={titulo}
          rows={2}
          maxLength={BOARD_LIMITS.titleMax}
          onChange={e => setTitulo(e.target.value.replace(/\n/g, ' '))}
          onBlur={salvarTitulo}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
        />
        <p className="quadro-painel-ajuda" data-erro={erroTitulo ? '' : undefined}>
          {erroTitulo || `Curto e fácil de entender. ${BOARD_LIMITS.titleMax - titulo.length} caracteres restantes.`}
        </p>

        <section className="quadro-painel-secao" aria-labelledby="quadro-painel-etiquetas">
          <h4 id="quadro-painel-etiquetas">Etiquetas</h4>
          <div className="quadro-painel-etiquetas">
            {BOARD_LABELS.map(etiqueta => {
              const ligada = cartao.labels.includes(etiqueta.id);
              const cheia = !ligada && cartao.labels.length >= BOARD_LIMITS.labelsMax;
              return (
                <button
                  key={etiqueta.id}
                  type="button"
                  className="quadro-etiqueta quadro-etiqueta-alternar"
                  data-etiqueta={etiqueta.id}
                  aria-pressed={ligada}
                  disabled={cheia}
                  title={cheia ? `Use no máximo ${BOARD_LIMITS.labelsMax} etiquetas por cartão.` : undefined}
                  onClick={() => alternarEtiqueta(etiqueta.id)}
                >
                  {ligada && <Check size={12} strokeWidth={2} aria-hidden="true" />}{etiqueta.name}
                </button>
              );
            })}
          </div>
        </section>

        <section className="quadro-painel-secao" aria-labelledby="quadro-painel-prioridade">
          <h4 id="quadro-painel-prioridade">Prioridade</h4>
          <div className="quadro-painel-prioridades" role="radiogroup" aria-labelledby="quadro-painel-prioridade">
            {PRIORIDADES.map(p => (
              <button
                key={p.nome}
                type="button"
                role="radio"
                aria-checked={cartao.priority === p.id}
                data-prioridade={p.id ?? 'none'}
                onClick={() => { if (cartao.priority !== p.id) void salvar({ priority: p.id }); }}
              >
                {p.nome}
              </button>
            ))}
          </div>
        </section>

        <section className="quadro-painel-secao" aria-label="Depende de você">
          <div className="quadro-painel-depende">
            <button
              type="button"
              role="checkbox"
              id="quadro-painel-depende"
              className="quadro-caixa"
              aria-checked={cartao.needsOwner}
              aria-describedby="quadro-painel-depende-ajuda"
              onClick={() => void salvar({ needsOwner: !cartao.needsOwner })}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
            </button>
            <label htmlFor="quadro-painel-depende">Depende de você</label>
            <p id="quadro-painel-depende-ajuda" className="quadro-painel-ajuda">Marque quando este cartão está esperando uma decisão ou uma ação sua.</p>
          </div>
        </section>

        <section className="quadro-painel-secao" aria-labelledby="quadro-painel-anotacoes">
          <h4 id="quadro-painel-anotacoes">Anotações</h4>
          <textarea
            className="quadro-painel-descricao"
            aria-labelledby="quadro-painel-anotacoes"
            value={descricao}
            rows={5}
            maxLength={BOARD_LIMITS.descriptionMax}
            placeholder="Detalhes, contexto, links. Pode explicar com calma."
            onChange={e => setDescricao(e.target.value)}
            onBlur={() => { if (descricao !== cartao.description) void salvar({ description: descricao }); }}
          />
        </section>

        <section className="quadro-painel-secao" aria-labelledby="quadro-painel-lista">
          <div className="quadro-painel-lista-topo">
            <h4 id="quadro-painel-lista">Lista de verificação</h4>
            {total > 0 && <span className="quadro-painel-lista-conta" data-completo={feitos === total ? '' : undefined}>{feitos} de {total}</span>}
          </div>
          {total > 0 && (
            <span className="quadro-progresso quadro-progresso-grande" aria-hidden="true">
              <span style={{ transform: `scaleX(${feitos / total})` }} />
            </span>
          )}
          <ul className="quadro-painel-itens">
            {cartao.checklist.map(item => (
              <li key={item.id} className="quadro-painel-item" data-feito={item.done ? '' : undefined}>
                <button type="button" role="checkbox" aria-checked={item.done} className="quadro-caixa" onClick={() => alternarItem(item.id)} aria-label={item.text}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
                </button>
                <span className="quadro-painel-item-texto">{item.text}</span>
                <button type="button" className="icon-button quadro-painel-item-tirar" aria-label={`Tirar da lista: ${item.text}`} onClick={() => tirarItem(item.id)}>
                  <X size={14} strokeWidth={1.6} />
                </button>
              </li>
            ))}
          </ul>
          <form className="quadro-painel-novo-item" onSubmit={e => { e.preventDefault(); adicionarItem(); }}>
            <input
              value={novoItem}
              maxLength={BOARD_LIMITS.checklistItemMax}
              onChange={e => setNovoItem(e.target.value)}
              placeholder="Adicionar um passo"
              aria-label="Adicionar item à lista de verificação"
              disabled={total >= BOARD_LIMITS.checklistMax}
            />
            <button type="submit" className="button secondary" disabled={!novoItem.trim()}><Plus size={14} />Adicionar item</button>
          </form>
        </section>

        <section className="quadro-painel-secao" aria-labelledby="quadro-painel-historico">
          <h4 id="quadro-painel-historico">Histórico</h4>
          {historico === undefined ? (
            <p className="quadro-painel-ajuda">Carregando o histórico…</p>
          ) : (
            <ol className="quadro-painel-eventos">
              {historico.map(evento => (
                <li key={evento.id}>
                  <span className="quadro-avatar" style={{ '--cor-nome': corDoNome(evento.actor) } as CSSProperties} aria-hidden="true">{inicial(evento.actor)}</span>
                  <span className="quadro-painel-evento-texto"><strong>{evento.actor}</strong>{evento.summary}</span>
                  <time dateTime={evento.createdAt}>{tempoRelativo(evento.createdAt, agora)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="quadro-painel-rodape">
          <span>Criado por {cartao.createdBy}, {tempoRelativo(cartao.createdAt, agora)}</span>
          {confirmandoExclusao ? (
            <span className="quadro-painel-confirmar" role="alertdialog" aria-label="Confirmar exclusão">
              <span>Excluir este cartão? O histórico continua guardado.</span>
              <button type="button" className="button ghost" onClick={() => setConfirmandoExclusao(false)}>Cancelar</button>
              <button type="button" className="button danger" onClick={() => void excluir()}>Excluir cartão</button>
            </span>
          ) : (
            <button type="button" className="text-button quadro-painel-excluir" onClick={() => setConfirmandoExclusao(true)}>
              <Trash2 size={14} strokeWidth={1.6} />Excluir cartão
            </button>
          )}
        </footer>
      </div>
    </dialog>
  );
}
