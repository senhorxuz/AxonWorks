import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AprovacaoDaEntrega, EstadoDaEntrega } from '../../shared/entrega';
import { api, ApiError, errorText } from '../api';
import { SelosDaEntrega } from './SelosDaEntrega';
import { aprovacoesVigentes, origemDaAprovacao, textoDaAprovacaoDesfeita, tituloDaAprovacao } from './texto';

type Gravar = (pedido: () => Promise<EstadoDaEntrega>, confirmacao: string, depoisDeSalvar?: () => void) => Promise<void>;

export function EntregaDoCartao({ projectId, cardId, aoAtualizar }: {
  projectId: string;
  cardId: string;
  aoAtualizar: (entrega: EstadoDaEntrega) => void;
}) {
  const [entrega, setEntrega] = useState<EstadoDaEntrega | null>();
  const [tentativa, setTentativa] = useState(0);
  const [erroDeLeitura, setErroDeLeitura] = useState('');
  const [erroAoSalvar, setErroAoSalvar] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [salvando, setSalvando] = useState(false);
  const gravando = useRef(false);
  const titulo = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    api.entrega(projectId, cardId, controller.signal).then(estado => {
      if (!controller.signal.aborted) setEntrega(estado);
    }).catch(erro => {
      if (controller.signal.aborted) return;
      const detalhe = erro instanceof ApiError ? ` ${errorText(erro)}` : '';
      setErroDeLeitura(`Não foi possível carregar a entrega.${detalhe}`);
    });
    return () => controller.abort();
  }, [projectId, cardId, tentativa]);

  const gravar: Gravar = async (pedido, confirmacao, depoisDeSalvar) => {
    if (gravando.current) return;
    gravando.current = true;
    setSalvando(true);
    setErroAoSalvar('');
    setMensagem('');
    try {
      const estado = await pedido();
      depoisDeSalvar?.();
      setEntrega(estado);
      setMensagem(confirmacao);
      aoAtualizar(estado);
    } catch (erro) {
      setErroAoSalvar(erro instanceof ApiError ? errorText(erro) : 'Não foi possível salvar a aprovação. Tente novamente.');
    } finally {
      setSalvando(false);
      gravando.current = false;
    }
  };

  function tentarNovamente() {
    setErroDeLeitura('');
    setTentativa(n => n + 1);
  }

  function desfazer(id: string, botao: HTMLButtonElement) {
    void gravar(
      () => api.desfazerAprovacaoDaEntrega(projectId, cardId, id),
      'Aprovação desfeita.',
      () => { if (document.activeElement === botao) titulo.current?.focus(); },
    );
  }

  return (
    <section className="quadro-painel-secao entrega-painel" aria-labelledby="entrega-painel-titulo">
      <h4 id="entrega-painel-titulo" tabIndex={-1} ref={titulo}>Entrega</h4>
      {erroDeLeitura && (
        <div className="entrega-problema" role="alert">
          <p>{erroDeLeitura}</p>
          <button type="button" className="button secondary" onClick={tentarNovamente}>Tentar novamente</button>
        </div>
      )}
      {entrega === undefined && !erroDeLeitura && <p className="entrega-nota" role="status">Carregando a entrega…</p>}
      {entrega !== undefined && (
        <>
          {entrega ? <SelosDaEntrega entrega={entrega} /> : <p className="entrega-nota">Ainda não há registros desta entrega.</p>}
          <AcoesDaEntrega projectId={projectId} cardId={cardId} entrega={entrega} salvando={salvando} gravar={gravar} />
          {erroAoSalvar && <p className="entrega-problema" role="alert">{erroAoSalvar}</p>}
          <div className="entrega-feedback" aria-live="polite" aria-atomic="true">{salvando ? 'Salvando…' : mensagem}</div>
          <ListaDeAprovacoes aprovacoes={entrega?.aprovacoes ?? []} salvando={salvando} desfazer={desfazer} />
        </>
      )}
    </section>
  );
}

function AcoesDaEntrega({ projectId, cardId, entrega, salvando, gravar }: {
  projectId: string;
  cardId: string;
  entrega: EstadoDaEntrega | null;
  salvando: boolean;
  gravar: Gravar;
}) {
  const [textoDoAmbiente, setTextoDoAmbiente] = useState('');
  const ambiente = textoDoAmbiente.trim();
  const vigentes = aprovacoesVigentes(entrega?.aprovacoes ?? []);
  const visualAprovado = vigentes.some(aprovacao => aprovacao.tipo === 'visual');
  const ambienteAutorizado = vigentes.some(aprovacao => aprovacao.ambiente === ambiente);

  function autorizar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!ambiente || ambienteAutorizado) return;
    void gravar(() => api.aprovarEntrega(projectId, cardId, { tipo: 'publicacao', ambiente }), `Publicação autorizada em ${ambiente}.`);
  }

  return (
    <div className="entrega-acoes">
      <button type="button" className="button secondary" aria-disabled={salvando || visualAprovado}
        onClick={() => { if (!visualAprovado) void gravar(() => api.aprovarEntrega(projectId, cardId, { tipo: 'visual' }), 'Visual aprovado.'); }}>
        Aprovar visual
      </button>
      <form className="entrega-form" onSubmit={autorizar}>
        <label htmlFor="entrega-ambiente">Ambiente de publicação</label>
        <input id="entrega-ambiente" placeholder="Ex.: staging" value={textoDoAmbiente} maxLength={100} required
          onChange={evento => setTextoDoAmbiente(evento.target.value)} />
        <button type="submit" className="button secondary" aria-disabled={salvando || !ambiente || ambienteAutorizado}>
          {ambiente ? `Autorizar publicação em ${ambiente}` : 'Autorizar publicação'}
        </button>
      </form>
    </div>
  );
}

function ListaDeAprovacoes({ aprovacoes, salvando, desfazer }: {
  aprovacoes: AprovacaoDaEntrega[];
  salvando: boolean;
  desfazer: (id: string, botao: HTMLButtonElement) => void;
}) {
  if (aprovacoes.length === 0) return null;

  return (
    <div className="entrega-historico">
      <h5>Aprovações</h5>
      <ul className="entrega-aprovacoes">
        {aprovacoes.map(aprovacao => {
          const escopo = tituloDaAprovacao(aprovacao);
          return (
            <li key={aprovacao.id} className="entrega-aprovacao">
              <div>
                <strong>{escopo}</strong>
                <p>{origemDaAprovacao(aprovacao)}</p>
                {aprovacao.fraseDoDono && <blockquote>{aprovacao.fraseDoDono}</blockquote>}
              </div>
              {aprovacao.desfeitaEm ? (
                <span className="entrega-desfeita">{textoDaAprovacaoDesfeita(aprovacao)}</span>
              ) : (
                <button type="button" className="button ghost" aria-disabled={salvando}
                  aria-label={`Desfazer ${escopo.charAt(0).toLowerCase()}${escopo.slice(1)}`}
                  onClick={evento => desfazer(aprovacao.id, evento.currentTarget)}>
                  Desfazer
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
