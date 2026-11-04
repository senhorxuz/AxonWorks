import { useMemo, type CSSProperties, type FormEvent } from 'react';
import { ArrowRight, Plus, Search } from 'lucide-react';
import type { ContentEntry, ContentKind } from '../../shared/library';
import { guilloche, tomDoTipo } from './arte';
import { livroAberto } from './livro';
import { resumoDaBiblioteca } from './heroi';
import './heroi.css';

/**
 * O hero da Biblioteca: a cabeça da página. Título, descrição, busca e "Novo conteúdo" num lugar só;
 * uma linha com o que importa (quantos, de quais tipos, o último guardado); e à direita um livro aberto
 * em traço fino, com o ex-libris do projeto na página: a mesma linguagem dos emblemas dos cartões.
 */

type Estilo = CSSProperties & Record<`--${string}`, string | number>;


export function HeroDaBiblioteca(props: {
  semente: string;
  documentos: ContentEntry[];
  rotulos: Record<ContentKind, string>;
  busca: string;
  aoMudarBusca: (texto: string) => void;
  aoBuscar: (evento: FormEvent) => void;
  ocupado: boolean;
  podeCriar: boolean;
  aoCriar: () => void;
  aoAbrir: (id: string) => void;
}) {
  const { semente, documentos, rotulos, busca, aoMudarBusca, aoBuscar, ocupado, podeCriar, aoCriar, aoAbrir } = props;
  const resumo = useMemo(
    () => resumoDaBiblioteca(documentos.map(d => ({ id: d.item.id, titulo: d.item.title, tipo: d.item.kind, quando: d.item.updatedAt })), rotulos, Date.now()),
    [documentos, rotulos],
  );
  const livro = useMemo(() => livroAberto(semente), [semente]);
  const emblema = useMemo(() => guilloche(semente, livro.emblema.r).camadas, [semente, livro.emblema.r]);

  return (
    <header className="heroi">
      <div className="heroi-conteudo">
        <span className="heroi-rotulo">Biblioteca do projeto</span>
        <h2 className="heroi-titulo">Biblioteca</h2>
        <p className="heroi-descricao">Materiais versionados deste projeto. Editar cria uma revisão nova. Conteúdo de IA é relato, não diretriz.</p>

        <form className="heroi-busca" onSubmit={aoBuscar}>
          <label className="library-search heroi-campo">
            <Search size={15} />
            <input aria-label="Buscar na revisão vigente" placeholder="Buscar na revisão vigente…" value={busca} onChange={evento => aoMudarBusca(evento.target.value)} />
          </label>
          <button className="button secondary" disabled={ocupado}>{busca.trim() ? 'Buscar' : 'Mostrar todos'}</button>
          <button type="button" className="button primary" onClick={aoCriar} disabled={!podeCriar}><Plus size={16} />Novo conteúdo</button>
        </form>

        <div className="heroi-resumo">
          <strong>{resumo.frase}</strong>
          {resumo.tipos.map(t => (
            <span key={t.tipo} className="heroi-tipo"><i style={{ background: tomDoTipo(t.tipo) }} />{t.rotulo} <b>{t.quantidade}</b></span>
          ))}
        </div>
        {resumo.ultimo && (
          <button type="button" className="heroi-ultimo" onClick={() => aoAbrir(resumo.ultimo!.id)}>
            <span>Último guardado {resumo.ultimo.haQuanto}:</span> <b>{resumo.ultimo.titulo}</b><ArrowRight size={14} />
          </button>
        )}
      </div>

      <svg className="heroi-livro" viewBox="0 0 320 210" aria-hidden="true">
        <defs>
          <radialGradient id="heroi-luz" cx="50%" cy="45%" r="55%">
            <stop offset="0" stopColor="#e8794a" stopOpacity="0.16" />
            <stop offset="0.6" stopColor="#e8794a" stopOpacity="0.04" />
            <stop offset="1" stopColor="#e8794a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="heroi-papel-esquerda" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#25221f" />
            <stop offset="0.82" stopColor="#1f1d1b" />
            <stop offset="1" stopColor="#161514" />
          </linearGradient>
          <linearGradient id="heroi-papel-direita" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="#25221f" />
            <stop offset="0.82" stopColor="#1f1d1b" />
            <stop offset="1" stopColor="#161514" />
          </linearGradient>
          <linearGradient id="heroi-vinco" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity="0" />
            <stop offset="0.5" stopColor="#000" stopOpacity="0.5" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="heroi-fita" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f08b5d" />
            <stop offset="1" stopColor="#b9532b" />
          </linearGradient>
          <filter id="heroi-desfoque" x="-10%" y="-50%" width="120%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        <ellipse cx="160" cy="104" rx="158" ry="86" fill="url(#heroi-luz)" />
        <ellipse cx="160" cy="197" rx="138" ry="7" className="heroi-livro-chao" filter="url(#heroi-desfoque)" />

        <path d={livro.capa} className="heroi-livro-capa" />
        <g className="heroi-livro-bordas">
          {livro.bordas.map((d, i) => <path key={i} d={d} />)}
        </g>
        <path d={livro.paginaEsquerda} fill="url(#heroi-papel-esquerda)" className="heroi-livro-pagina" />
        <path d={livro.paginaDireita} fill="url(#heroi-papel-direita)" className="heroi-livro-pagina" />
        <path d={livro.sombra} fill="url(#heroi-vinco)" />

        <g className="heroi-livro-texto">
          {livro.linhas.map((linha, i) => (
            <path key={i} d={linha.d} className={linha.tipo === 'titulo' ? 'heroi-livro-titulo' : 'heroi-livro-linha'} style={{ '--i': i } as Estilo} />
          ))}
        </g>

        <g className="heroi-livro-emblema" transform={`translate(${livro.emblema.cx - livro.emblema.r} ${livro.emblema.cy - livro.emblema.r})`}>
          <circle cx={livro.emblema.r} cy={livro.emblema.r} r={livro.emblema.r + 3} className="heroi-livro-selo" />
          {emblema.map((d, i) => <path key={i} d={d} className={`heroi-livro-guilloche heroi-livro-guilloche-${i}`} />)}
        </g>

        <path d={livro.fita} fill="url(#heroi-fita)" className="heroi-livro-fita" />
      </svg>
    </header>
  );
}
