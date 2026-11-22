import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { nomeDoDono } from './quadro/api-quadro';
import { autoriaDaTela } from './identidade/identidade';
import { BookMarked, X } from 'lucide-react';
import type { ContentDocument, ContentEntry, ContentKind, ContentSourceKind } from '../shared/library';
import { api, errorText } from './api';
import { chaveDaChegada, rolagemParaMostrar } from './chegada/chegada';
import { irPara } from './chegada/irPara';
import { Markdown } from './texto/DocumentoMarkdown';
import { previaDoConteudo, tomDoTipo } from './biblioteca/arte';
import { ExLibris } from './biblioteca/ExLibris';
import { HeroDaBiblioteca } from './biblioteca/HeroDaBiblioteca';
import { useFeedback } from './Feedback';
import { DateLabel, EmptyNote, Modal } from './ui';

const KIND_LABEL: Record<ContentKind, string> = {
  note: 'Nota',
  specification: 'Especificação',
  research: 'Pesquisa',
  reference: 'Referência',
  artifact: 'Artefato',
};

const SOURCE_LABEL: Record<ContentSourceKind, string> = {
  human_directive: 'Diretriz humana',
  agent_report: 'Relato de agente',
  external_reference: 'Referência externa',
};

/** `abrirPedido`: um documento a abrir assim que a aba aparece (vem das Relações); `aoAbrirPedido` avisa que já foi atendido. */
/** Quem assina e de que origem nasce vem da mesma regra da Diretriz: com nome na barra, a IA; sem nome, o dono. */
export function LibraryPanel({ projectId, agent, abrirPedido, aoAbrirPedido }: { projectId: string; agent: string; abrirPedido?: { id: string } | null; aoAbrirPedido?: () => void }) {
  const notify = useFeedback();
  const [items, setItems] = useState<ContentEntry[]>([]);
  const [selected, setSelected] = useState<ContentDocument | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revising, setRevising] = useState(false);
  const lista = useRef<HTMLDivElement>(null);

  // Esc fecha o documento aberto e volta para a grade (menos quando uma janela de edição está aberta).
  useEffect(() => {
    if (!selected || creating || revising) return;
    const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [selected, creating, revising]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const list = await api.content(projectId, false, signal);
    if (!signal?.aborted) setItems(list);
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((err) => {
      if (!controller.signal.aborted) setError(errorText(err));
    });
    return () => controller.abort();
  }, [load]);

  async function openItem(itemId: string) {
    setError('');
    try {
      setSelected(await api.contentItem(projectId, itemId));
      // O leitor, onde quer que tenha aberto, recebe a chegada.
      irPara({ chave: chaveDaChegada('conteudo', itemId) });
    } catch (err) {
      setError(errorText(err));
    }
  }

  // A lista tem rolagem própria na leitura: o item escolhido continua à vista nela (sem mexer na rolagem da página).
  useLayoutEffect(() => {
    const caixa = lista.current;
    const item = caixa?.querySelector<HTMLElement>('.library-item.is-active');
    if (!caixa || !item) return;
    const c = caixa.getBoundingClientRect();
    const i = item.getBoundingClientRect();
    caixa.scrollTop = rolagemParaMostrar({ topoDoItem: i.top, alturaDoItem: i.height, topoDaLista: c.top, alturaDaLista: c.height, rolagemAtual: caixa.scrollTop });
  }, [selected?.item.id]);

  useEffect(() => {
    if (!abrirPedido) return;
    void openItem(abrirPedido.id);
    aoAbrirPedido?.();
  }, [abrirPedido]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) {
      await load();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const results = await api.searchContent(projectId, query.trim());
      setItems(results);
      setSelected(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await api.archiveContent(projectId, selected.item.id, { expectedVersion: selected.item.version });
      notify('Conteúdo arquivado', 'Saiu da busca vigente. O histórico permanece.');
      setSelected(null);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="library-panel" aria-label="Biblioteca de conteúdos">
      <HeroDaBiblioteca
        semente={projectId}
        documentos={items}
        rotulos={KIND_LABEL}
        busca={query}
        aoMudarBusca={setQuery}
        aoBuscar={(event) => void search(event)}
        ocupado={busy}
        podeCriar
        aoCriar={() => setCreating(true)}
        aoAbrir={(id) => void openItem(id)}
      />
      {error && <div className="alert" role="alert">{error}</div>}
      {items.length === 0 ? (
        <EmptyNote>
          <BookMarked size={22}/>
          <p>Nenhum conteúdo vigente.<br/><span>Guarde o que a próxima IA precisa ler sem reabrir o chat.</span></p>
        </EmptyNote>
      ) : (
        <>
        <div className={'library-layout ' + (selected ? 'lendo' : 'em-grade')}>
          <div className="library-list" ref={lista}>
            {items.map((entry) => (
              <button
                type="button"
                key={entry.item.id}
                className={'library-item' + (selected?.item.id === entry.item.id ? ' is-active' : '')}
                onClick={() => void openItem(entry.item.id)}
              >
                <strong>{entry.item.title}</strong>
                <small>{KIND_LABEL[entry.item.kind]} · revisão {entry.revision.revision}</small>
                {/* Na leitura, a lista é compacta: prévia e emblema só na grade. */}
                {!selected && <ExLibris semente={entry.item.id} tamanho={46} tom={tomDoTipo(entry.item.kind)} />}
                {!selected && <span className="library-item-previa">{previaDoConteudo(entry.revision.body)}</span>}
              </button>
            ))}
          </div>
          {selected && (
            <article className="library-document" data-chegada={chaveDaChegada('conteudo', selected.item.id)}>
              <ExLibris semente={selected.item.id} tamanho={150} tom={tomDoTipo(selected.item.kind)} />
              <button type="button" className="icon-button library-document-fechar" aria-label="Fechar documento" title="Fechar (Esc)" onClick={() => setSelected(null)}><X size={16} /></button>
              <header>
                <span className="eyebrow">{KIND_LABEL[selected.item.kind]} · {SOURCE_LABEL[selected.revision.sourceKind]}</span>
                <h3>{selected.item.title}</h3>
                <p>Relatado por {selected.revision.createdBy} · <DateLabel value={selected.revision.createdAt}/> · revisão {selected.revision.revision}</p>
              </header>
              <Markdown texto={selected.revision.body} />
              {selected.revisions.length > 1 && (
                <p className="subtle-text">{selected.revisions.length} revisões no histórico. A busca usa só a vigente.</p>
              )}
              <div className="library-document-actions">
                <button type="button" className="button secondary" disabled={busy} onClick={() => setRevising(true)}>Nova revisão</button>
                <button type="button" className="text-button" disabled={busy} onClick={() => void archive()}>Arquivar</button>
              </div>
            </article>
          )}
        </div>
        </>
      )}
      {creating && (
        <ContentFormDialog
          title="Novo conteúdo"
          agent={agent}
          onClose={() => setCreating(false)}
          onSubmit={async (payload) => {
            const created = await api.createContent(projectId, payload);
            notify('Conteúdo guardado', created.item.title);
            setCreating(false);
            await load();
            await openItem(created.item.id);
          }}
        />
      )}
      {revising && selected && (
        <ContentFormDialog
          title="Nova revisão"
          agent={agent}
          initialTitle={selected.item.title}
          initialBody={selected.revision.body}
          initialKind={selected.item.kind}
          initialSourceKind={selected.revision.sourceKind}
          onClose={() => setRevising(false)}
          onSubmit={async (payload) => {
            const updated = await api.reviseContent(projectId, selected.item.id, {
              ...payload,
              expectedVersion: selected.item.version,
            });
            notify('Revisão gravada', 'A anterior permanece no histórico.');
            setRevising(false);
            await load();
            await openItem(updated.item.id);
          }}
        />
      )}
    </section>
  );
}

function ContentFormDialog({
  title,
  agent,
  initialSourceKind,
  initialTitle = '',
  initialBody = '',
  initialKind = 'note',
  onClose,
  onSubmit,
}: {
  title: string
  agent: string
  initialSourceKind?: ContentSourceKind
  initialTitle?: string
  initialBody?: string
  initialKind?: ContentKind
  onClose: () => void
  onSubmit: (input: {
    title: string
    kind: ContentKind
    body: string
    createdBy: string
    sourceKind: ContentSourceKind
  }) => Promise<void>
}) {
  const autoria = autoriaDaTela(agent, nomeDoDono(), initialSourceKind);
  const [name, setName] = useState(initialTitle);
  const [kind, setKind] = useState<ContentKind>(initialKind);
  const [body, setBody] = useState(initialBody);
  const [sourceKind, setSourceKind] = useState<ContentSourceKind>(autoria.origem);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({ title: name, kind, body, createdBy: autoria.autor, sourceKind });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} eyebrow="BIBLIOTECA · NÃO INICIA IA" onClose={onClose} wide>
      <p className="modal-description">O texto fica versionado. Relato de agente não substitui uma diretriz humana.</p>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label>Título<input autoFocus value={name} onChange={(event) => setName(event.target.value)} required maxLength={200}/></label>
        <div className="form-columns">
          <label>Tipo<select value={kind} onChange={(event) => setKind(event.target.value as ContentKind)}>
            {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Origem<select aria-label="Origem" value={sourceKind} onChange={(event) => setSourceKind(event.target.value as ContentSourceKind)}>
            {Object.entries(SOURCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
        <label>Texto<textarea aria-label="Texto do conteúdo" value={body} onChange={(event) => setBody(event.target.value)} required maxLength={200000} rows={8}/></label>
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          <button className="button primary" disabled={busy || !name.trim() || !body.trim()}>{busy ? 'Salvando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}
