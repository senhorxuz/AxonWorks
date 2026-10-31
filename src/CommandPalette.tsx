import { useState } from 'react';
import { ArrowUpRight, BookOpen, Check, Folder, Plug, Plus, Search } from 'lucide-react';
import type { Project } from '../shared/types';
import { Modal } from './ui';
export function CommandPalette({ projects, onClose, onCreate }: { projects: Project[]; onClose:()=>void; onCreate:()=>void }) {
  const [query,setQuery]=useState('');
  const [index,setIndex]=useState(0);
  const commands=[
    ...projects.map(project=>({id:project.id,label:project.name,detail:'Projeto',icon:Folder,run:()=>{window.location.hash='project/'+project.id;onClose();}})),
    {id:'new',label:'Novo projeto',detail:'Criar',icon:Plus,run:()=>{onClose();onCreate();}},
    {id:'connect',label:'Conexões',detail:'Configurar',icon:Plug,run:()=>{window.location.hash='connect';onClose();}},
    {id:'guide',label:'Guia para IAs',detail:'Como usar a Axon Works',icon:BookOpen,run:()=>{window.location.hash='guide';onClose();}}
  ].filter(command=>command.label.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).slice(0,12);
  const selected = Math.min(index,Math.max(0,commands.length-1));
  return <Modal title="Ir para..." onClose={onClose}><div className="command-search"><Search size={18}/><input autoFocus aria-label="Buscar comandos e projetos" placeholder="Buscar projeto ou ação..." value={query} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" aria-activedescendant={commands[selected]?'command-'+commands[selected].id:undefined} onChange={event=>{setQuery(event.target.value);setIndex(0);}} onKeyDown={event=>{
    if(event.key==='ArrowDown'){event.preventDefault();setIndex((selected+1)%Math.max(1,commands.length));}
    else if(event.key==='ArrowUp'){event.preventDefault();setIndex((selected+commands.length-1)%Math.max(1,commands.length));}
    else if(event.key==='Enter'){event.preventDefault();commands[selected]?.run();}
  }}/><kbd>esc</kbd></div><div id="command-results" role="listbox" aria-label="Projetos e ações" className="command-results">{commands.length?commands.map((command,i)=><button id={'command-'+command.id} type="button" key={command.id} role="option" aria-selected={i===selected} tabIndex={-1} onMouseEnter={()=>setIndex(i)} onClick={command.run}><command.icon size={17}/><span>{command.label}</span><small>{command.detail}</small><ArrowUpRight size={13}/></button>):<p>Nenhum resultado para “{query}”.</p>}</div><div className="command-footer"><span>↑ ↓ navegar</span><span>↵ abrir</span></div></Modal>;
}
