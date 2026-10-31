import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BookMarked, Plus, Search } from 'lucide-react';
import type { ContentDocument, ContentEntry, ContentKind, ContentSourceKind } from '../shared/library';
import { api, errorText } from './api';
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

export function LibraryPanel({ projectId, agent }: { projectId: string; agent: string }) {
  const notify = useFeedback();
  const [items, setItems] = useState<ContentEntry[]>([]);
  const [selected, setSelected] = useState<ContentDocument | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revising, setRevising] = useState(false);

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
    } catch (err) {
      setError(errorText(err));
    }
  }

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
      <div className="section-heading">
        <div>
          <h2>Biblioteca</h2>
          <p>Materiais versionados deste projeto. Editar cria uma revisão nova. Conteúdo de IA é relato, não diretriz.</p>
        </div>
        <button type="button" className="button primary" onClick={() => setCreating(true)} disabled={!agent}>
          <Plus size={16}/>Novo conteúdo
        </button>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      <form className="library-search-bar" onSubmit={(event) => void search(event)}>
        <label className="library-search">
          <Search size={15}/>
          <input
            aria-label="Buscar na revisão vigente"
            placeholder="Buscar na revisão vigente…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="button secondary" disabled={busy}>{query.trim() ? 'Buscar' : 'Mostrar todos'}</button>
      </form>
      {items.length === 0 ? (
        <EmptyNote>
          <BookMarked size={22}/>
          <p>Nenhum conteúdo vigente.<br/><span>Guarde o que a próxima IA precisa ler sem reabrir o chat.</span></p>
        </EmptyNote>
      ) : (
        <div className="library-layout">
          <div className="library-list">
            {items.map((entry) => (
              <button
                type="button"
                key={entry.item.id}
                className={'library-item' + (selected?.item.id === entry.item.id ? ' is-active' : '')}
                onClick={() => void openItem(entry.item.id)}
              >
                <strong>{entry.item.title}</strong>
                <small>{KIND_LABEL[entry.item.kind]} · revisão {entry.revision.revision}</small>
              </button>
            ))}
          </div>
          {selected && (
            <article className="library-document">
              <header>
                <span className="eyebrow">{KIND_LABEL[selected.item.kind]} · {SOURCE_LABEL[selected.revision.sourceKind]}</span>
                <h3>{selected.item.title}</h3>
                <p>Relatado por {selected.revision.createdBy} · <DateLabel value={selected.revision.createdAt}/> · revisão {selected.revision.revision}</p>
              </header>
              <pre>{selected.revision.body}</pre>
              {selected.revisions.length > 1 && (
                <p className="subtle-text">{selected.revisions.length} revisões no histórico. A busca usa só a vigente.</p>
              )}
              <div className="library-document-actions">
                <button type="button" className="button secondary" disabled={!agent || busy} onClick={() => setRevising(true)}>Nova revisão</button>
                <button type="button" className="text-button" disabled={!agent || busy} onClick={() => void archive()}>Arquivar</button>
              </div>
            </article>
          )}
        </div>
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
  initialTitle = '',
  initialBody = '',
  initialKind = 'note',
  onClose,
  onSubmit,
}: {
  title: string
  agent: string
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
  const [name, setName] = useState(initialTitle);
  const [kind, setKind] = useState<ContentKind>(initialKind);
  const [body, setBody] = useState(initialBody);
  const [sourceKind, setSourceKind] = useState<ContentSourceKind>(agent ? 'agent_report' : 'human_directive');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!agent) { setError('Informe o nome do agente na barra lateral.'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit({ title: name, kind, body, createdBy: agent, sourceKind });
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
          <button className="button primary" disabled={busy || !name.trim() || !body.trim() || !agent}>{busy ? 'Salvando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}
