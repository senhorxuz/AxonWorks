import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Artigos } from './Artigos';
import { secoesDe } from './secoes';

/** O editor: o texto à esquerda e, à direita, "Como vai ficar" mudando a cada letra. */
export function EditorDaDiretriz({ textoAtual, nomeDoProjeto, rotuloDoSalvar, busy, salvar, cancelar }: {
  textoAtual: string; nomeDoProjeto: string; rotuloDoSalvar: string; busy: boolean; salvar: (texto: string) => void; cancelar: () => void;
}) {
  const [texto, setTexto] = useState(textoAtual);
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { campo.current?.focus({ preventScroll: true }); }, []);

  function enviar(event: FormEvent) {
    event.preventDefault();
    salvar(texto);
  }

  return <form className="dz-editor" onSubmit={enviar}>
    <label>
      Texto da diretriz
      <span className="dz-dica">Uma linha só em MAIÚSCULAS vira o título de uma seção. Cada frase vira um item.</span>
      <textarea ref={campo} aria-label="Texto vigente da diretriz do projeto" value={texto} onChange={event => setTexto(event.target.value)} required maxLength={8000} disabled={busy}/>
    </label>
    <div className="dz-ao-vivo">
      <p className="dz-rotulo">Como vai ficar</p>
      <Artigos secoes={secoesDe(texto)} nomeDoProjeto={nomeDoProjeto} prefixo="dz-previa"/>
    </div>
    <div className="dz-acoes">
      <button type="submit" className="dz-botao principal" disabled={busy || !texto.trim() || texto === textoAtual}>{rotuloDoSalvar}</button>
      <button type="button" className="dz-botao" disabled={busy} onClick={cancelar}>Cancelar</button>
    </div>
  </form>;
}
