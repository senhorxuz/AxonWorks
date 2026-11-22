import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { LICAO_MOTIVO_MAXIMO, LICAO_TEXTO_MAXIMO, MOMENTOS_DA_VERIFICACAO, type Licao, type MomentoDaVerificacao } from '../../shared/licoes';
import { ApiError } from '../api';
import { mensagemDaEscrita, rotulosDaEdicao, ROTULOS_DOS_MOMENTOS, type AcaoSobreLicao } from './texto';
import { salvarLicao } from './useRegras';

interface Propriedades {
  projectId: string;
  acao: AcaoSobreLicao;
  aoCancelar: () => void;
  aoSalvar: (licao: Licao, mensagem: string) => void;
}

export function EditarLicao({ projectId, acao, aoCancelar, aoSalvar }: Propriedades) {
  const id = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState(acao.tipo === 'corrigir' ? acao.licao.texto : '');
  const [momento, setMomento] = useState<MomentoDaVerificacao | ''>('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const rotulos = rotulosDaEdicao(acao);
  const retirar = acao.tipo === 'aposentar';
  const escolherMomento = acao.tipo === 'criar' && acao.categoria === 'verificacao';

  useLayoutEffect(() => {
    const elemento = dialogo.current!;
    elemento.showModal();
    campo.current?.focus();
    return () => elemento.close();
  }, []);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (salvando || !texto.trim() || (escolherMomento && !momento)) return;
    setSalvando(true);
    setErro('');
    try {
      const licao = await salvarLicao(projectId, acao, texto, momento || undefined);
      aoSalvar(licao, rotulos.sucesso);
    } catch (falha) {
      setErro(mensagemDaEscrita(falha instanceof ApiError ? falha.code : undefined));
    } finally {
      setSalvando(false);
    }
  }

  return <dialog className="regras-dialogo" ref={dialogo} aria-labelledby={`${id}-titulo`} onCancel={evento => {
    evento.preventDefault();
    if (!salvando) aoCancelar();
  }}>
    <form onSubmit={enviar}>
      <h2 id={`${id}-titulo`}>{rotulos.titulo}</h2>
      {retirar && <p className="regras-dialogo-contexto">{acao.licao.texto}</p>}
      <label htmlFor={`${id}-texto`}>{rotulos.campo}</label>
      <textarea id={`${id}-texto`} ref={campo} required maxLength={retirar ? LICAO_MOTIVO_MAXIMO : LICAO_TEXTO_MAXIMO}
        rows={4} value={texto} onChange={evento => setTexto(evento.target.value)} readOnly={salvando}/>
      {escolherMomento && <>
        <label htmlFor={`${id}-momento`}>Quando conferir</label>
        <select id={`${id}-momento`} required value={momento} onChange={evento => setMomento(evento.target.value as MomentoDaVerificacao)} disabled={salvando}>
          <option value="" disabled>Escolha um momento</option>
          {MOMENTOS_DA_VERIFICACAO.map(valor => <option key={valor} value={valor}>{ROTULOS_DOS_MOMENTOS[valor]}</option>)}
        </select>
      </>}
      {erro && <p className="regras-aviso" role="alert">{erro}</p>}
      <div className="regras-form-acoes">
        <button type="button" className="button secondary" disabled={salvando} onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="button primary" disabled={salvando || !texto.trim() || (escolherMomento && !momento)}>
          {salvando ? 'Salvando…' : rotulos.botao}
        </button>
      </div>
    </form>
  </dialog>;
}
