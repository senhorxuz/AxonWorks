import { useId, useLayoutEffect, useRef, type FormEvent } from 'react';
import type { ItemNaLixeira } from '../../shared/lixeira';
import { dataDaLicao } from './texto';
import { prenderTab } from '../foco/armadilha';
import type { useLixeira } from './useLixeira';

type EstadoDaLixeira = ReturnType<typeof useLixeira>;

export function Lixeira({ estado, restaurar, confirmarApagamento }: {
  estado: EstadoDaLixeira; restaurar: (item: ItemNaLixeira) => void; confirmarApagamento: (item: ItemNaLixeira) => void;
}) {
  const { carregando, erroDeLeitura, itens, ocupada, recarregar } = estado;
  if (carregando) return <p className="regras-vazio" role="status">Buscando os itens da lixeira…</p>;
  if (erroDeLeitura) return <div className="regras-estado">
    <p role="alert">{erroDeLeitura}</p>
    <button type="button" className="button secondary" disabled={ocupada} onClick={recarregar}>Tentar abrir a lixeira novamente</button>
  </div>;
  if (!itens.length) return <p className="regras-vazio">A lixeira está vazia</p>;
  return <ul className="regras-lista">
    {itens.map(item => <li className="regras-orientacao" key={`${item.tipo}:${item.id}`}>
      <div className="regras-orientacao-texto">
        <p className="regras-texto">{item.titulo}</p>
        <p className="regras-autoria">Enviado por {item.excluidoPor} em <time dateTime={item.excluidoEm}>{dataDaLicao(item.excluidoEm)}</time></p>
      </div>
      <div className="regras-acoes">
        <button type="button" className="regras-acao" disabled={ocupada} onClick={() => restaurar(item)}
          aria-label={`Restaurar: ${item.titulo}`}>Restaurar</button>
        <button type="button" className="regras-acao" disabled={ocupada} onClick={() => confirmarApagamento(item)}
          aria-label={`Apagar de vez: ${item.titulo}`}>Apagar de vez</button>
      </div>
    </li>)}
  </ul>;
}

export function ConfirmarApagamento({ item, ocupada, erro, cancelar, confirmar }: {
  item: ItemNaLixeira; ocupada: boolean; erro: string; cancelar: () => void; confirmar: () => void;
}) {
  const id = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const botaoCancelar = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const elemento = dialogo.current!;
    elemento.showModal();
    botaoCancelar.current?.focus();
    return () => elemento.close();
  }, []);

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!ocupada) confirmar();
  }

  return <dialog className="regras-dialogo" ref={dialogo} aria-labelledby={`${id}-titulo`} aria-describedby={`${id}-descricao`} onCancel={evento => {
    evento.preventDefault();
    if (!ocupada) cancelar();
  }} onKeyDown={evento => prenderTab(evento, dialogo.current)}>
    <form onSubmit={enviar}>
      <h2 id={`${id}-titulo`}>Apagar de vez</h2>
      <p className="regras-dialogo-contexto">{item.titulo}</p>
      <p id={`${id}-descricao`}>Depois de apagar, você perde a opção de restaurar este item.</p>
      {erro && <p className="regras-aviso" role="alert">{erro}</p>}
      <div className="regras-form-acoes">
        <button type="button" className="button secondary" ref={botaoCancelar} disabled={ocupada} onClick={cancelar}>Cancelar</button>
        <button type="submit" className="button primary" disabled={ocupada}>{ocupada ? 'Apagando…' : 'Apagar de vez'}</button>
      </div>
    </form>
  </dialog>;
}
