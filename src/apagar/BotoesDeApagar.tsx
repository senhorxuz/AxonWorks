import { useState, type FormEvent } from 'react';
import './apagar.css';
import { Eraser, Trash2 } from 'lucide-react';
import { AGENTE_AUTOMATICO } from '../../shared/carta';
import { api, errorText } from '../api';
import { useFeedback } from '../Feedback';
import { Modal } from '../ui';
import { PALAVRA_DE_CONFIRMACAO, confirmouApagarRegistro, fraseDasOcorrencias, fraseDoApagado, trechoPreenchido } from './apagar';

type Caixa = 'trecho' | 'registro' | null;

/**
 * Os dois botões de apagar de um registro (aba Checkpoints e cada salvamento de "Onde paramos").
 * Só o dono vê esta tela; as IAs não têm como apagar histórico.
 */
export function BotoesDeApagar({ projectId, checkpointId, onApagado }: { projectId: string; checkpointId: string; onApagado: () => void | Promise<void> }) {
  const [caixa, setCaixa] = useState<Caixa>(null);
  async function aoApagar() {
    setCaixa(null);
    await onApagado();
  }
  return (
    <div className="apagar-acoes">
      <button type="button" className="button ghost" onClick={() => setCaixa('trecho')}><Eraser size={15} aria-hidden="true" />Apagar trecho</button>
      <button type="button" className="button ghost apagar-perigo" onClick={() => setCaixa('registro')}><Trash2 size={15} aria-hidden="true" />Apagar registro inteiro</button>
      {caixa === 'trecho' && <ApagarTrecho projectId={projectId} checkpointId={checkpointId} onClose={() => setCaixa(null)} onApagado={aoApagar} />}
      {caixa === 'registro' && <ApagarRegistro projectId={projectId} checkpointId={checkpointId} onClose={() => setCaixa(null)} onApagado={aoApagar} />}
    </div>
  );
}

interface PropsDaCaixa { projectId: string; checkpointId: string; onClose: () => void; onApagado: () => Promise<void> }

function ApagarTrecho({ projectId, checkpointId, onClose, onApagado }: PropsDaCaixa) {
  const notificar = useFeedback();
  const [trecho, setTrecho] = useState('');
  const [ocorrencias, setOcorrencias] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function conferir(evento: FormEvent) {
    evento.preventDefault();
    if (!trechoPreenchido(trecho)) { setErro('Cole o trecho que você quer apagar.'); return; }
    setErro('');
    setOcupado(true);
    try {
      setOcorrencias((await api.contarTrecho(projectId, checkpointId, trecho)).ocorrencias);
    } catch (falha) {
      setErro(errorText(falha));
    } finally {
      setOcupado(false);
    }
  }

  async function apagar() {
    setErro('');
    setOcupado(true);
    try {
      const resultado = await api.apagarTrecho(projectId, checkpointId, trecho);
      notificar('Trecho apagado', fraseDoApagado(resultado));
      await onApagado();
    } catch (falha) {
      setErro(errorText(falha));
      setOcupado(false);
    }
  }

  return (
    <Modal title="Apagar trecho" eyebrow="APAGAR DE VERDADE" onClose={onClose} wide>
      <p className="modal-description">
        Cole o texto exatamente como ele aparece no registro. Toda vez que ele aparecer, vai virar o aviso “trecho apagado pelo dono”, também na busca e na retomada das IAs.
      </p>
      <form onSubmit={conferir} className="form-stack">
        <label>
          Texto exato que você quer apagar
          <textarea value={trecho} onChange={evento => { setTrecho(evento.target.value); setOcorrencias(null); }} rows={4} maxLength={8000} />
        </label>
        {erro && <div className="alert" role="alert">{erro}</div>}
        {ocorrencias !== null && <p className="apagar-contagem" role="status">{fraseDasOcorrencias(ocorrencias)}</p>}
        {ocorrencias !== null && ocorrencias > 0 && (
          <p className="apagar-aviso">Não dá para desfazer. Cópias de segurança feitas antes de hoje ainda guardam o texto antigo.</p>
        )}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          {ocorrencias !== null && ocorrencias > 0
            ? <button type="button" className="button danger" disabled={ocupado} onClick={apagar}>{ocupado ? 'Apagando…' : 'Apagar de vez'}</button>
            : <button type="submit" className="button primary" disabled={ocupado}>{ocupado ? 'Conferindo…' : 'Conferir quantas vezes aparece'}</button>}
        </div>
      </form>
    </Modal>
  );
}

function ApagarRegistro({ projectId, checkpointId, onClose, onApagado }: PropsDaCaixa) {
  const notificar = useFeedback();
  const [confirmacao, setConfirmacao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const confirmou = confirmouApagarRegistro(confirmacao);

  async function apagar(evento: FormEvent) {
    evento.preventDefault();
    if (!confirmou) return;
    setErro('');
    setOcupado(true);
    try {
      const resultado = await api.apagarRegistro(projectId, checkpointId);
      notificar('Registro apagado', fraseDoApagado(resultado));
      await onApagado();
    } catch (falha) {
      setErro(errorText(falha));
      setOcupado(false);
    }
  }

  return (
    <Modal title="Apagar registro inteiro" eyebrow="APAGAR DE VERDADE" onClose={onClose}>
      <p className="modal-description">
        Todo o texto deste registro vira o aviso “registro apagado pelo dono”. Ficam só a data, quem gravou e o número da versão.
      </p>
      <p className="apagar-aviso">Não dá para desfazer. Cópias de segurança feitas antes de hoje ainda guardam o texto antigo.</p>
      <form onSubmit={apagar} className="form-stack">
        <label>
          Para confirmar, digite {PALAVRA_DE_CONFIRMACAO}
          <input value={confirmacao} onChange={evento => setConfirmacao(evento.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        {erro && <div className="alert" role="alert">{erro}</div>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button danger" disabled={!confirmou || ocupado}>{ocupado ? 'Apagando…' : 'Apagar registro inteiro'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** "Descartar" do rascunho automático visível em "Onde paramos": dois cliques, para não sumir sem querer. */
export function DescartarRascunhoAutomatico({ projectId, versao, onDescartado }: { projectId: string; versao: number; onDescartado: () => void }) {
  const notificar = useFeedback();
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function descartar() {
    setErro('');
    setOcupado(true);
    try {
      await api.discardWorkDraft(projectId, { agent: AGENTE_AUTOMATICO, expectedVersion: versao, taskId: null });
      notificar('Rascunho descartado', 'Os registros salvos continuam como estavam.');
      onDescartado();
    } catch (falha) {
      setErro(errorText(falha));
    } finally {
      setOcupado(false);
      setConfirmando(false);
    }
  }

  return (
    <div className="rascunho-descartar">
      {confirmando
        ? <>
            <p>Descartar este rascunho? Não dá para desfazer.</p>
            <button type="button" className="button danger" disabled={ocupado} onClick={descartar}>{ocupado ? 'Descartando…' : 'Sim, descartar'}</button>
            <button type="button" className="button ghost" onClick={() => setConfirmando(false)}>Cancelar</button>
          </>
        : <button type="button" className="button ghost" onClick={() => setConfirmando(true)}><Trash2 size={15} aria-hidden="true" />Descartar</button>}
      {erro && <div className="alert" role="alert">{erro}</div>}
    </div>
  );
}
