import { useEffect, useState, type FormEvent } from 'react';
import type { CharterRevision } from '../../shared/continuity';
import { api, errorText } from '../api';
import { useFeedback } from '../Feedback';
import './diretriz.css';

const formatoDaData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });

export function Diretriz({ projectId, agent, refresh }: { projectId: string; agent: string; refresh: () => Promise<void> }) {
  const notify = useFeedback();
  const [charter, setCharter] = useState<CharterRevision | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [falhaNaLeitura, setFalhaNaLeitura] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void api.charter(projectId, signal).then(item => {
      if (signal.aborted) return;
      setCharter(item);
    }).catch(err => {
      if (signal.aborted) return;
      setFalhaNaLeitura(true);
      setError(errorText(err));
    }).finally(() => {
      if (!signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [projectId, tentativa]);

  function tentarNovamente() {
    setError('');
    setFalhaNaLeitura(false);
    setLoading(true);
    setTentativa(atual => atual + 1);
  }

  async function aplicar(
    acao: () => Promise<CharterRevision | null>,
    carregando: string,
    concluido: string,
  ) {
    setBusy(true);
    setError('');
    setStatus(carregando);
    try {
      const next = await acao();
      setCharter(next);
      setEditing(false);
      setStatus(concluido);
      await refresh();
    } catch (err) {
      setError(errorText(err));
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  function save(body: string) {
    if (!agent) { setError('Informe o nome do agente na barra lateral.'); return; }
    void aplicar(async () => {
      const next = await api.saveCharter(projectId, { actor: agent, body, expectedRevision: charter?.revision ?? 0 });
      notify('Diretriz do projeto atualizada', `Versão ${next.revision}`);
      return next;
    }, 'Salvando a diretriz…', 'Diretriz salva.');
  }

  const aberta = !loading && !falhaNaLeitura;
  return <section className="panel diretriz" aria-label="Diretriz do projeto">
    <div className="panel-heading">
      <h2>Diretriz do projeto</h2>
      {aberta && <span className="mono-label">{charter ? `VERSÃO ${charter.revision}` : 'AUSENTE'}</span>}
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    <p role="status" className="diretriz-status">{loading ? 'Buscando a diretriz…' : status}</p>
    {falhaNaLeitura && <button type="button" className="button secondary" onClick={tentarNovamente}>Tentar novamente</button>}
    {charter?.sourceKind === 'agent_update' && <div className="diretriz-aviso">
      <p>Atualizada por {charter.createdBy} (nome declarado) em <time dateTime={charter.createdAt}>{formatoDaData.format(new Date(charter.createdAt))}</time>{charter.motivo && `: ${charter.motivo}`}</p>
      <div className="form-row-actions">
        {!charter.vistoPeloDonoEm && <button type="button" className="button primary" disabled={busy || editing}
          onClick={() => void aplicar(() => api.conferirDiretriz(projectId), 'Registrando sua conferência…', 'Diretriz conferida.')}>Está certo</button>}
        <button type="button" className="button secondary" disabled={busy || editing}
          onClick={() => void aplicar(() => api.desfazerDiretriz(projectId), 'Voltando ao seu texto…', 'Seu texto voltou a ser a diretriz.')}>Voltar ao meu texto</button>
      </div>
    </div>}
    {aberta && (editing ? (
      <EditarDiretriz textoAtual={charter?.body} agent={agent} busy={busy} salvar={save} cancelar={() => setEditing(false)}/>
    ) : (
      <div className="charter-collapsed-view">
        {charter?.body ? <p className="charter-preview-body">{charter.body}</p> : <p className="subtle-text">Nenhuma diretriz definida ainda.</p>}
        <button type="button" className="button secondary" disabled={busy} onClick={() => setEditing(true)}>Editar diretriz</button>
      </div>
    ))}
  </section>;
}

function EditarDiretriz({ textoAtual = '', agent, busy, salvar, cancelar }: {
  textoAtual?: string; agent: string; busy: boolean; salvar: (body: string) => void; cancelar: () => void;
}) {
  const [body, setBody] = useState(textoAtual);

  function enviar(event: FormEvent) {
    event.preventDefault();
    salvar(body);
  }

  return <form className="form-stack" onSubmit={enviar}>
    <label>Texto vigente da diretriz do projeto<textarea aria-label="Texto vigente da diretriz do projeto" value={body} onChange={event => setBody(event.target.value)} required maxLength={8000} rows={3} disabled={busy}/></label>
    <div className="form-row-actions">
      <button className="button secondary" disabled={busy || !body.trim() || !agent || body === textoAtual}>Salvar versão</button>
      <button type="button" className="button ghost" disabled={busy} onClick={cancelar}>Cancelar</button>
    </div>
  </form>;
}
