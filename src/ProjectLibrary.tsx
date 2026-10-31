import { useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, Folder, FolderPlus, LayoutGrid, List, Plus, Search, Star, Trash2, X } from 'lucide-react';
import type { Project } from '../shared/types';
import { DateLabel, firstMeaningfulParagraph } from './ui';
import { textosDoModo, useModo } from './modo';

export function ProjectLibrary({ projects, loading, onCreate, onImport, onDelete }: { projects: Project[]; loading: boolean; onCreate: () => void; onImport: () => void; onDelete: (project: Project) => void }) {
  const textos = textosDoModo(useModo() ?? 'local');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'context' | 'pinned'>('all');
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [pins, setPins] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('axon-pins') || '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
  });
  const [notice, setNotice] = useState('');
  function togglePin(project: Project) {
    const hadPin = pins.includes(project.id);
    const next = hadPin ? pins.filter(id => id !== project.id) : [...pins, project.id];
    setPins(next); try { localStorage.setItem('axon-pins', JSON.stringify(next)); } catch { /* Preference remains available for this visit. */ }
    setNotice(project.name + (hadPin ? ' removido dos favoritos.' : ' adicionado aos favoritos.'));
  }
  const visible = projects.filter(project => {
    const matchesQuery = (project.name+' '+project.objective+' '+project.workspacePath).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'));
    return matchesQuery && (filter !== 'context' || project.revision > 0) && (filter !== 'pinned' || pins.includes(project.id));
  }).sort((a,b) => {
    const pinnedFirst = Number(pins.includes(b.id)) - Number(pins.includes(a.id));
    if (pinnedFirst) return pinnedFirst;
    return sort === 'name' ? a.name.localeCompare(b.name,'pt-BR') : Date.parse(b.updatedAt)-Date.parse(a.updatedAt);
  });
  return <>
    <div className="page-heading library-heading"><div><h1>Projetos <span className="heading-count">{projects.length}</span></h1><p>Abra um projeto para continuar o trabalho.</p></div><div className="heading-actions"><button className="button secondary" onClick={onImport}><ArrowDownToLine size={15}/>Importar projeto</button><button className="button primary" onClick={onCreate}><Plus size={16}/>Novo projeto</button></div></div>
    <div className="library-toolbar">
      <div className="library-filters" role="group" aria-label="Filtrar projetos">
        <button aria-pressed={filter==='all'} onClick={() => setFilter('all')}>Todos<span>{projects.length}</span></button>
        <button aria-pressed={filter==='pinned'} onClick={() => setFilter('pinned')}><Star size={12}/>Favoritos</button>
        <button aria-pressed={filter==='context'} onClick={() => setFilter('context')}>{textos.filtroComCheckpoint}</button>
      </div>
      <div className="library-tools">
        <label className="library-search"><Search size={15}/><input id="project-search" aria-label="Buscar projetos" placeholder="Filtrar projetos..." value={query} onChange={event => setQuery(event.target.value)}/>{query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')}><X size={12}/></button>}</label>
        <select aria-label="Ordenar projetos" value={sort} onChange={event=>setSort(event.target.value as typeof sort)}><option value="recent">Recentes</option><option value="name">Nome</option></select>
        <div className="view-switch" role="group" aria-label="Visualização"><button aria-label="Visualização em lista" aria-pressed={layout==='list'} onClick={()=>setLayout('list')}><List size={16}/></button><button aria-label="Visualização em grade" aria-pressed={layout==='grid'} onClick={()=>setLayout('grid')}><LayoutGrid size={15}/></button></div>
      </div>
    </div>
    {notice && <div className="preference-notice" role="status"><Check size={12}/>{notice}<button onClick={()=>setNotice('')} aria-label="Fechar aviso"><X size={12}/></button></div>}
    {loading ? <div className="library-skeleton" role="status" aria-label="Carregando projetos">{[0,1,2].map(n=><div key={n}><span/><div/><small/></div>)}</div> : projects.length === 0 ? <div className="library-empty">
      <div className="empty-project-graphic" aria-hidden="true"><div className="empty-sheet sheet-back"/><div className="empty-sheet sheet-front"><Folder size={27} strokeWidth={1.25}/><i/><i/><i/></div><span className="empty-plus"><Plus size={15}/></span></div>
      <h2>Sua área de trabalho está pronta.</h2><p>Adicione um projeto e organize tarefas,<br/>decisões e próximos passos.</p><button className="button primary" onClick={onCreate}><FolderPlus size={16}/>Adicionar primeiro projeto</button>
      <span className="empty-help">Os dados ficam neste computador.</span>
    </div> : visible.length === 0 ? <div className="library-empty compact"><Search size={28} strokeWidth={1.3}/><h2>Nenhum projeto encontrado</h2><p>Experimente outro nome ou remova os filtros.</p><button className="button secondary" onClick={()=>{setQuery('');setFilter('all');}}>Limpar filtros</button></div> : <div className={'library-projects '+(layout==='grid'?'as-grid':'as-list')}>
      {layout==='list' && <div className="library-columns" aria-hidden="true"><span>PROJETO</span><span>SALVO NESTE COMPUTADOR</span><span>ATUALIZADO</span><span/></div>}
      {visible.map((project,index)=><article className="library-project" key={project.id}>
        <a href={'#project/'+project.id} className="project-open"><span className={'project-monogram tone-'+(index%3)}><Folder size={20} strokeWidth={1.4}/></span><div><h3>{project.name}</h3><p>{firstMeaningfulParagraph(project.objective)}</p><span className="project-location">{project.workspacePath || 'Sem pasta vinculada'}</span></div></a>
        <div className="library-context"><span className={project.revision>0?'status-tag':'status-tag neutral'}>{project.revision>0?<><span className="tiny-dot"/>versão {project.revision}</>:'Sem checkpoint'}</span></div>
        <div className="library-updated"><DateLabel value={project.updatedAt}/></div>
        <div className="library-row-actions"><button className={'pin-button '+(pins.includes(project.id)?'is-pinned':'')} aria-label={(pins.includes(project.id)?'Desfavoritar ':'Favoritar ')+project.name} aria-pressed={pins.includes(project.id)} onClick={()=>togglePin(project)}><Star size={15} fill={pins.includes(project.id)?'currentColor':'none'}/></button><button type="button" className="icon-button library-delete" aria-label={'Excluir '+project.name} title={'Excluir '+project.name} onClick={()=>onDelete(project)}><Trash2 size={15}/></button><a className="icon-button open-project-button" href={'#project/'+project.id} aria-label={'Abrir '+project.name}><ArrowUpRight size={17}/></a></div>
      </article>)}
    </div>}
    <div className="library-bottom"><span>{visible.length} {visible.length===1?'projeto':'projetos'}{filter!=='all'||query?' no filtro':''}</span><span><kbd>Ctrl</kbd><kbd>K</kbd> alternar projeto</span></div>
  </>;
}
