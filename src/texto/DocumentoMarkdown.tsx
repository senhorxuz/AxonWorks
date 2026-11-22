import { createElement, Fragment, useMemo, type ReactNode } from 'react';
import { lerMarkdown, type Bloco, type Trecho } from './markdown';

/** Os trechos viram elementos React: o texto entra como texto (React escapa), nunca como HTML. */
function Trechos({ trechos }: { trechos: Trecho[] }) {
  return <>{trechos.map((trecho, i): ReactNode => {
    if (trecho.tipo === 'negrito') return <strong key={i}>{trecho.texto}</strong>;
    if (trecho.tipo === 'italico') return <em key={i}>{trecho.texto}</em>;
    if (trecho.tipo === 'codigo') return <code key={i}>{trecho.texto}</code>;
    return <Fragment key={i}>{trecho.texto}</Fragment>;
  })}</>;
}

function BlocoDoDocumento({ bloco }: { bloco: Bloco }) {
  switch (bloco.tipo) {
    case 'titulo': return createElement(`h${Math.min(bloco.nivel + 3, 6)}`, null, <Trechos trechos={bloco.trechos} />);
    case 'paragrafo': return <p><Trechos trechos={bloco.trechos} /></p>;
    case 'lista': {
      const itens = bloco.itens.map((item, i) => <li key={i}><Trechos trechos={item} /></li>);
      return bloco.numerada ? <ol>{itens}</ol> : <ul>{itens}</ul>;
    }
    case 'codigo': return <pre className="md-codigo"><code>{bloco.texto}</code></pre>;
    case 'citacao': return <blockquote><Trechos trechos={bloco.trechos} /></blockquote>;
    case 'divisoria': return <hr />;
  }
}

/** Documento da Biblioteca lido como Markdown: títulos, negrito, listas e código em mono. */
export function Markdown({ texto }: { texto: string }) {
  const blocos = useMemo(() => lerMarkdown(texto), [texto]);
  return <div className="md">{blocos.map((bloco, i) => <BlocoDoDocumento key={i} bloco={bloco} />)}</div>;
}
