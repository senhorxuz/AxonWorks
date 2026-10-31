import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  Filter,
  Flag,
  Info,
  Layers,
  ListTodo,
  Network,
  RefreshCw,
  Search,
  Share2,
  ShieldAlert,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-react';
import type {
  DecisionConflict,
  DecisionConflictReport,
  GraphImpactReport,
  GraphNode,
  GraphNodeType,
  ProjectGraph,
  StaleContentItem,
  StaleContentReport,
} from '../shared/graph';
import { api, errorText } from './api';
import { useFeedback } from './Feedback';
import { DateLabel, EmptyNote } from './ui';

const NODE_TYPE_LABEL: Record<GraphNodeType, string> = {
  decision: 'Decisão',
  content: 'Biblioteca',
  task: 'Tarefa',
  blocker: 'Bloqueio',
};

const EDGE_KIND_LABEL: Record<string, string> = {
  supersedes: 'Substitui',
  contradicts: 'Contradiz',
  supports: 'Suporta',
  implements: 'Implementa',
  references: 'Referencia',
  depends_on: 'Depende de',
  blocks: 'Bloqueia',
};

export interface GraphPanelProps {
  projectId: string;
  agent: string;
  onNavigateTab?: (tab: string) => void;
  onIssuesCountChange?: (count: number) => void;
}

export function GraphPanel({ projectId, agent, onNavigateTab, onIssuesCountChange }: GraphPanelProps) {
  const notify = useFeedback();
  const [activeSubView, setActiveSubView] = useState<'visual' | 'conflicts' | 'stale'>('visual');
  const [typeFilter, setTypeFilter] = useState<'all' | GraphNodeType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  // Data states
  const [graph, setGraph] = useState<ProjectGraph | null>(null);
  const [conflicts, setConflicts] = useState<DecisionConflictReport | null>(null);
  const [stale, setStale] = useState<StaleContentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Impact Analysis State
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [impactReport, setImpactReport] = useState<GraphImpactReport | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState('');

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [g, c, s] = await Promise.all([
        api.graph(projectId, { includeArchived }, signal),
        api.graphConflicts(projectId, signal),
        api.graphStale(projectId, signal),
      ]);
      if (signal?.aborted) return;
      setGraph(g);
      setConflicts(c);
      setStale(s);
    } catch (err) {
      if (signal?.aborted) return;
      setError(errorText(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId, includeArchived]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  // Load impact analysis when a node is selected
  const handleSelectNode = useCallback(async (node: GraphNode | null) => {
    setSelectedNode(node);
    if (!node) {
      setImpactReport(null);
      setImpactError('');
      return;
    }
    setImpactLoading(true);
    setImpactError('');
    try {
      const report = await api.graphImpact(projectId, node.type, node.id);
      setImpactReport(report);
    } catch (err) {
      setImpactError(errorText(err));
      setImpactReport(null);
    } finally {
      setImpactLoading(false);
    }
  }, [projectId]);

  // Filtered nodes
  const filteredNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter(node => {
      if (typeFilter !== 'all' && node.type !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesLabel = node.label.toLowerCase().includes(q);
        const matchesType = NODE_TYPE_LABEL[node.type].toLowerCase().includes(q);
        return matchesLabel || matchesType;
      }
      return true;
    });
  }, [graph, typeFilter, searchQuery]);

  // Map of conflict node IDs for visual indicators
  const conflictNodeIds = useMemo(() => {
    const set = new Set<string>();
    if (conflicts) {
      for (const c of conflicts.conflicts) {
        for (const id of c.decisionIds) set.add(id);
      }
    }
    return set;
  }, [conflicts]);

  // Map of stale content IDs for visual indicators
  const staleItemIds = useMemo(() => {
    const set = new Set<string>();
    if (stale) {
      for (const item of stale.items) set.add(item.itemId);
    }
    return set;
  }, [stale]);

  // Connected edges for the selected node
  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode || !graph) return { incoming: [], outgoing: [] };
    const incoming = graph.edges.filter(e => e.toNodeId === selectedNode.id);
    const outgoing = graph.edges.filter(e => e.fromNodeId === selectedNode.id);
    return { incoming, outgoing };
  }, [selectedNode, graph]);

  const totalConflictsCount = (conflicts?.criticalCount ?? 0) + (conflicts?.warningCount ?? 0);
  const totalStaleCount = stale?.staleCount ?? 0;

  // O painel é a única fonte desses dados — a aba só monta este componente
  // quando o grafo é aberto, então o total sobe para o contador da aba
  // exatamente quando o próprio painel termina de carregar (sem um segundo
  // fetch duplicado feito por fora, com o painel fechado). Só reporta depois
  // que `conflicts` e `stale` chegaram de verdade: antes disso,
  // totalConflictsCount/totalStaleCount valem 0 por padrão, e relatar esse 0
  // seria um número falso, não um valor ainda desconhecido.
  useEffect(() => {
    if (!conflicts || !stale) return;
    onIssuesCountChange?.(totalConflictsCount + totalStaleCount);
  }, [conflicts, stale, totalConflictsCount, totalStaleCount, onIssuesCountChange]);

  return (
    <section className="graph-panel-container" aria-label="Grafo e Inteligência de Conhecimento">
      {/* Top Header & Summary KPI Cards */}
      <header className="graph-header">
        <div className="graph-header-title">
          <div className="eyebrow">
            <Network size={14} />
            <span>TOPOLOGIA & INTELIGÊNCIA RELACIONAL</span>
          </div>
          <h2>Grafo de Linhagem, Decisões & Dependências</h2>
          <p className="subtle-text">
            Mapeamento vivo de causas, efeitos e integridade semântica entre decisões canônicas, biblioteca, detalhes de tarefas e bloqueios.
          </p>
        </div>
        <div className="graph-header-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => void loadData()}
            disabled={loading}
            title="Recarregar grafo e diagnósticos"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* KPI Cards Row */}
      <div className="graph-kpi-grid">
        <div className="graph-kpi-card">
          <div className="graph-kpi-label">
            <Layers size={15} />
            <span>Total de Nós</span>
          </div>
          <div className="graph-kpi-val">{graph?.stats.totalNodes ?? 0}</div>
          <div className="graph-kpi-breakdown">
            <span>{graph?.stats.nodesByType.decision ?? 0} Decisões</span>
            <span>·</span>
            <span>{graph?.stats.nodesByType.content ?? 0} Docs</span>
            <span>·</span>
            <span>{graph?.stats.nodesByType.task ?? 0} Tarefas</span>
            <span>·</span>
            <span>{graph?.stats.nodesByType.blocker ?? 0} Bloqueios</span>
          </div>
        </div>

        <div className="graph-kpi-card">
          <div className="graph-kpi-label">
            <Share2 size={15} />
            <span>Relações Ativas</span>
          </div>
          <div className="graph-kpi-val">{graph?.stats.totalEdges ?? 0}</div>
          <div className="graph-kpi-breakdown">
            <span>Conexões estruturais, dependências e linhagem</span>
          </div>
        </div>

        <button
          type="button"
          className={`graph-kpi-card interactive ${totalConflictsCount > 0 ? 'has-critical' : ''}`}
          onClick={() => setActiveSubView('conflicts')}
          title="Ver auditoria de decisões conflitantes"
        >
          <div className="graph-kpi-label">
            <ShieldAlert size={15} className={totalConflictsCount > 0 ? 'alert-icon' : ''} />
            <span>Conflitos de Decisão</span>
          </div>
          <div className="graph-kpi-val">
            {totalConflictsCount}
            {conflicts?.criticalCount ? (
              <span className="kpi-tag critical">{conflicts.criticalCount} críticos</span>
            ) : conflicts?.warningCount ? (
              <span className="kpi-tag warning">{conflicts.warningCount} alertas</span>
            ) : (
              <span className="kpi-tag ok">0 conflitos</span>
            )}
          </div>
          <div className="graph-kpi-breakdown">
            {totalConflictsCount > 0
              ? 'Contradições, sobreposições ou ciclos detectados'
              : 'Nenhuma contradição vigente'}
          </div>
        </button>

        <button
          type="button"
          className={`graph-kpi-card interactive ${totalStaleCount > 0 ? 'has-warning' : ''}`}
          onClick={() => setActiveSubView('stale')}
          title="Ver conteúdos desatualizados por decisões"
        >
          <div className="graph-kpi-label">
            <AlertTriangle size={15} className={totalStaleCount > 0 ? 'warning-icon' : ''} />
            <span>Conteúdos Desatualizados</span>
          </div>
          <div className="graph-kpi-val">
            {totalStaleCount}
            {totalStaleCount > 0 ? (
              <span className="kpi-tag warning">{totalStaleCount} pendentes</span>
            ) : (
              <span className="kpi-tag ok">Biblioteca íntegra</span>
            )}
          </div>
          <div className="graph-kpi-breakdown">
            {totalStaleCount > 0
              ? 'Documentos afetados por decisões revogadas ou alteradas'
              : 'Todos os documentos alinhados com decisões'}
          </div>
        </button>
      </div>

      {/* Subviews Navigation Bar */}
      <div className="graph-subnav-bar">
        <div className="graph-subnav-tabs">
          <button
            type="button"
            className={`graph-subnav-btn ${activeSubView === 'visual' ? 'active' : ''}`}
            onClick={() => setActiveSubView('visual')}
          >
            <Network size={14} />
            <span>Mapa Topológico</span>
          </button>
          <button
            type="button"
            className={`graph-subnav-btn ${activeSubView === 'conflicts' ? 'active' : ''}`}
            onClick={() => setActiveSubView('conflicts')}
          >
            <ShieldAlert size={14} />
            <span>Inteligência de Conflitos</span>
            {totalConflictsCount > 0 && (
              <span className="subnav-badge alert">{totalConflictsCount}</span>
            )}
          </button>
          <button
            type="button"
            className={`graph-subnav-btn ${activeSubView === 'stale' ? 'active' : ''}`}
            onClick={() => setActiveSubView('stale')}
          >
            <AlertCircle size={14} />
            <span>Frescor de Biblioteca</span>
            {totalStaleCount > 0 && (
              <span className="subnav-badge warning">{totalStaleCount}</span>
            )}
          </button>
        </div>

        {/* Filter bar if in visual mode */}
        {activeSubView === 'visual' && (
          <div className="graph-filter-strip">
            <div className="graph-filter-types">
              <button
                type="button"
                className={`filter-pill ${typeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setTypeFilter('all')}
              >
                Todos
              </button>
              <button
                type="button"
                className={`filter-pill ${typeFilter === 'decision' ? 'active' : ''}`}
                onClick={() => setTypeFilter('decision')}
              >
                <Flag size={12} /> Decisões
              </button>
              <button
                type="button"
                className={`filter-pill ${typeFilter === 'content' ? 'active' : ''}`}
                onClick={() => setTypeFilter('content')}
              >
                <FileText size={12} /> Biblioteca
              </button>
              <button
                type="button"
                className={`filter-pill ${typeFilter === 'task' ? 'active' : ''}`}
                onClick={() => setTypeFilter('task')}
              >
                <ListTodo size={12} /> Tarefas
              </button>
              <button
                type="button"
                className={`filter-pill ${typeFilter === 'blocker' ? 'active' : ''}`}
                onClick={() => setTypeFilter('blocker')}
              >
                <AlertTriangle size={12} /> Bloqueios
              </button>
            </div>

            <div className="graph-search-input">
              <Search size={13} />
              <input
                type="text"
                placeholder="Filtrar nós por título..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" className="clear-search" onClick={() => setSearchQuery('')}>
                  <X size={12} />
                </button>
              )}
            </div>

            <label className="graph-archived-toggle" title="Incluir itens arquivados">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={e => setIncludeArchived(e.target.checked)}
              />
              <span>Arquivados</span>
            </label>
          </div>
        )}
      </div>

      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadData()}>
            Tentar novamente
          </button>
        </div>
      )}

      {/* Subview 1: MAPA TOPOLÓGICO */}
      {activeSubView === 'visual' && (
        <div className="graph-workspace-layout">
          <div className="graph-lanes-area">
            {loading && !graph ? (
              <div className="loading" role="status">
                <RefreshCw size={17} />
                <span>Construindo grafo de conhecimento e dependências…</span>
              </div>
            ) : filteredNodes.length === 0 ? (
              <EmptyNote>
                <Network size={28} />
                <p>
                  Nenhum nó encontrado para os filtros selecionados.
                  <br />
                  <span>Altere os filtros acima para visualizar os elementos do grafo.</span>
                </p>
              </EmptyNote>
            ) : (
              <div className="graph-lanes-grid">
                {/* Lane 1: Decisões */}
                <GraphLane
                  title="Decisões Canônicas"
                  icon={<Flag size={15} />}
                  type="decision"
                  count={filteredNodes.filter(n => n.type === 'decision').length}
                  nodes={filteredNodes.filter(n => n.type === 'decision')}
                  selectedNodeId={selectedNode?.id}
                  conflictNodeIds={conflictNodeIds}
                  staleItemIds={staleItemIds}
                  onSelectNode={handleSelectNode}
                />

                {/* Lane 2: Biblioteca */}
                <GraphLane
                  title="Biblioteca & Documentos"
                  icon={<FileText size={15} />}
                  type="content"
                  count={filteredNodes.filter(n => n.type === 'content').length}
                  nodes={filteredNodes.filter(n => n.type === 'content')}
                  selectedNodeId={selectedNode?.id}
                  conflictNodeIds={conflictNodeIds}
                  staleItemIds={staleItemIds}
                  onSelectNode={handleSelectNode}
                />

                {/* Lane 3: Tarefas & Contratos */}
                <GraphLane
                  title="Tarefas & Detalhes"
                  icon={<ListTodo size={15} />}
                  type="task"
                  count={filteredNodes.filter(n => n.type === 'task').length}
                  nodes={filteredNodes.filter(n => n.type === 'task')}
                  selectedNodeId={selectedNode?.id}
                  conflictNodeIds={conflictNodeIds}
                  staleItemIds={staleItemIds}
                  onSelectNode={handleSelectNode}
                />

                {/* Lane 4: Bloqueios */}
                <GraphLane
                  title="Bloqueios & Incertezas"
                  icon={<AlertTriangle size={15} />}
                  type="blocker"
                  count={filteredNodes.filter(n => n.type === 'blocker').length}
                  nodes={filteredNodes.filter(n => n.type === 'blocker')}
                  selectedNodeId={selectedNode?.id}
                  conflictNodeIds={conflictNodeIds}
                  staleItemIds={staleItemIds}
                  onSelectNode={handleSelectNode}
                />
              </div>
            )}
          </div>

          {/* Right Sidebar: Detalhe do Nó e Análise de Impacto a Jusante */}
          <aside className={`graph-inspector-sidebar ${selectedNode ? 'is-open' : ''}`}>
            {selectedNode ? (
              <div className="inspector-content">
                <div className="inspector-header">
                  <div className="inspector-node-type">
                    <NodeTypeBadge type={selectedNode.type} />
                    <span className="mono-label">ID: {selectedNode.id.slice(0, 8)}…</span>
                  </div>
                  <button
                    type="button"
                    className="close-inspector-btn"
                    onClick={() => handleSelectNode(null)}
                    aria-label="Fechar painel de inspeção"
                  >
                    <X size={15} />
                  </button>
                </div>

                <h3 className="inspector-title">{selectedNode.label}</h3>

                {/* Quick entity-specific metadata */}
                <div className="inspector-details-box">
                  {selectedNode.type === 'decision' && (
                    <DecisionNodeDetails data={selectedNode.data as any} />
                  )}
                  {selectedNode.type === 'content' && (
                    <ContentNodeDetails data={selectedNode.data as any} />
                  )}
                  {selectedNode.type === 'task' && (
                    <TaskNodeDetails data={selectedNode.data as any} />
                  )}
                  {selectedNode.type === 'blocker' && (
                    <BlockerNodeDetails data={selectedNode.data as any} />
                  )}
                </div>

                {/* Immediate connections summary */}
                <div className="inspector-connections">
                  <span className="inspector-section-label">
                    <Share2 size={13} /> Conexões Imediatas
                  </span>
                  <div className="connections-pills">
                    <span className="conn-pill incoming">
                      {selectedNodeEdges.incoming.length} Precedente(s)
                    </span>
                    <span className="conn-pill outgoing">
                      {selectedNodeEdges.outgoing.length} Sucessor(es)
                    </span>
                  </div>

                  {selectedNodeEdges.incoming.length > 0 && (
                    <div className="conn-list">
                      <small>Entradas (Precedentes):</small>
                      {selectedNodeEdges.incoming.map(edge => {
                        const source = graph?.nodes.find(n => n.id === edge.fromNodeId);
                        return (
                          <div key={edge.id} className="conn-item">
                            <ArrowRight size={11} className="conn-arrow" />
                            <span className="conn-kind">{EDGE_KIND_LABEL[edge.kind] || edge.kind}</span>
                            <span className="conn-label" title={source?.label || edge.fromNodeId}>
                              {source?.label || edge.fromNodeId.slice(0, 8)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {selectedNodeEdges.outgoing.length > 0 && (
                    <div className="conn-list">
                      <small>Saídas (Impacto direto):</small>
                      {selectedNodeEdges.outgoing.map(edge => {
                        const target = graph?.nodes.find(n => n.id === edge.toNodeId);
                        return (
                          <div key={edge.id} className="conn-item">
                            <ArrowRight size={11} className="conn-arrow outgoing" />
                            <span className="conn-kind">{EDGE_KIND_LABEL[edge.kind] || edge.kind}</span>
                            <span className="conn-label" title={target?.label || edge.toNodeId}>
                              {target?.label || edge.toNodeId.slice(0, 8)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Downstream Impact & Reachability Section */}
                <div className="inspector-impact-section">
                  <div className="impact-header-row">
                    <span className="inspector-section-label">
                      <Zap size={14} /> Análise de Alcance e Impacto
                    </span>
                    {impactReport && (
                      <span className={`risk-badge risk-${impactReport.riskLevel}`}>
                        Risco {{ high: 'Crítico', medium: 'Atenção', low: 'Baixo' }[impactReport.riskLevel]}
                      </span>
                    )}
                  </div>

                  {impactLoading ? (
                    <div className="impact-loading">
                      <RefreshCw size={14} className="spin" />
                      <span>Propagando alcance topológico…</span>
                    </div>
                  ) : impactError ? (
                    <p className="impact-error">{impactError}</p>
                  ) : impactReport ? (
                    <div className="impact-report-body">
                      <div className="impact-summary-chips">
                        <div className="impact-chip">
                          <strong>{impactReport.impactSummary.totalImpacted}</strong>
                          <span>Afetados</span>
                        </div>
                        <div className="impact-chip">
                          <strong>{impactReport.impactSummary.tasksImpacted}</strong>
                          <span>Tarefas</span>
                        </div>
                        <div className="impact-chip">
                          <strong>{impactReport.impactSummary.decisionsImpacted}</strong>
                          <span>Decisões</span>
                        </div>
                        <div className="impact-chip">
                          <strong>{impactReport.impactSummary.contentImpacted}</strong>
                          <span>Docs</span>
                        </div>
                      </div>

                      {impactReport.impactedEntities.length === 0 ? (
                        <p className="impact-empty-note">
                          Nenhum nó a jusante foi afetado por este elemento. A alteração possui raio de impacto isolado.
                        </p>
                      ) : (
                        <div className="impacted-entities-list">
                          <small>Cadeia de propagação por distância topológica:</small>
                          {impactReport.impactedEntities.map(ent => (
                            <div key={ent.id} className={`impacted-card sev-${ent.severity}`}>
                              <div className="impacted-card-head">
                                <span className="impacted-dist">d={ent.distance}</span>
                                <NodeTypeBadge type={ent.type} />
                                <strong className="impacted-name" title={ent.label}>
                                  {ent.label}
                                </strong>
                              </div>
                              <p className="impacted-reason">{ent.reason}</p>
                              {ent.relationPath.length > 0 && (
                                <div className="impacted-path" title={ent.relationPath.join(' → ')}>
                                  <span>Caminho: </span>
                                  <code>{ent.relationPath.join(' → ')}</code>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Quick actions for inspected node */}
                <div className="inspector-actions">
                  {onNavigateTab && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        if (selectedNode.type === 'decision') onNavigateTab('decisions');
                        else if (selectedNode.type === 'content') onNavigateTab('library');
                        else if (selectedNode.type === 'task') onNavigateTab('overview');
                        else if (selectedNode.type === 'blocker') onNavigateTab('overview');
                      }}
                    >
                      <ExternalLink size={13} />
                      <span>Abrir na aba de origem</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="inspector-empty">
                <Network size={28} />
                <h3>Nenhum nó selecionado</h3>
                <p>Clique em qualquer decisão, documento, tarefa ou bloqueio para inspecionar conexões e simular o impacto a jusante.</p>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Subview 2: INTELIGÊNCIA DE CONFLITOS */}
      {activeSubView === 'conflicts' && (
        <div className="graph-subview-panel">
          <div className="panel-heading">
            <div>
              <h3>Diagnósticos de Conflito em Decisões</h3>
              <p>
                Detecção determinística de contradições diretas, sobreposições de diretivas vigentes, decisões zumbis e referências cíclicas.
              </p>
            </div>
            <span className="count-badge">
              {conflicts?.conflictCount ?? 0} {conflicts?.conflictCount === 1 ? 'conflito' : 'conflitos'}
            </span>
          </div>

          {!conflicts || conflicts.conflicts.length === 0 ? (
            <EmptyNote>
              <CheckCircle2 size={32} className="text-ok" />
              <p>
                Nenhum conflito encontrado!
                <br />
                <span>Todas as decisões aceitas estão em consonância mútua e suas linhagens estão estritamente acíclicas.</span>
              </p>
            </EmptyNote>
          ) : (
            <div className="conflicts-list">
              {conflicts.conflicts.map(conf => (
                <article key={conf.id} className={`conflict-card sev-${conf.severity}`}>
                  <div className="conflict-card-header">
                    <span className={`status-tag sev-badge-${conf.severity}`}>
                      {conf.severity === 'critical' ? 'Crítico' : conf.severity === 'warning' ? 'Alerta' : 'Informativo'}
                    </span>
                    <span className="conflict-kind-tag">
                      {{
                        direct_contradiction: 'Contradição Direta Declarada',
                        overlapping_accepted_decisions: 'Sobreposição de Decisões Vigentes',
                        unresolved_supersession: 'Substituição Pendente (Zumbi)',
                        circular_supersession: 'Ciclo de Substituição (Anomalia)',
                      }[conf.type] || conf.type}
                    </span>
                  </div>

                  <h4 className="conflict-summary">{conf.summary}</h4>
                  <p className="conflict-explanation">{conf.explanation}</p>

                  <div className="conflict-recommendation-box">
                    <strong>Recomendação de Mitigação:</strong>
                    <p>{conf.recommendation}</p>
                  </div>

                  <div className="conflict-footer">
                    <span className="conflict-decisions-count">
                      Decisões envolvidas: {conf.decisionIds.length}
                    </span>
                    {onNavigateTab && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onNavigateTab('decisions')}
                      >
                        Ir para Decisões <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Subview 3: FRESCO DE BIBLIOTECA (STALE CONTENT) */}
      {activeSubView === 'stale' && (
        <div className="graph-subview-panel">
          <div className="panel-heading">
            <div>
              <h3>Auditoria de Frescor de Conteúdo da Biblioteca</h3>
              <p>
                Documentos e especificações cuja validade foi comprometida por decisões revogadas, versões substituídas ou contradições explícitas.
              </p>
            </div>
            <span className="count-badge">
              {stale?.staleCount ?? 0} {stale?.staleCount === 1 ? 'item afetado' : 'itens afetados'}
            </span>
          </div>

          {!stale || stale.items.length === 0 ? (
            <EmptyNote>
              <CheckCircle2 size={32} className="text-ok" />
              <p>
                Biblioteca 100% atualizada!
                <br />
                <span>Nenhum documento se apoia em decisões revogadas ou declarou perda de validade.</span>
              </p>
            </EmptyNote>
          ) : (
            <div className="stale-list">
              {stale.items.map(item => (
                <article key={item.itemId} className={`stale-card sev-${item.severity}`}>
                  <div className="stale-card-header">
                    <span className={`status-tag sev-badge-${item.severity}`}>
                      {item.severity === 'critical' ? 'Crítico' : 'Alerta de Frescor'}
                    </span>
                    <span className="stale-reason-tag">
                      {{
                        dependency_decision_revoked: 'Decisão de Apoio Revogada',
                        dependency_decision_superseded: 'Decisão Substituída por Nova Versão',
                        contradicts_accepted_decision: 'Contradiz Decisão Vigente',
                        referenced_content_archived_or_outdated: 'Referência a Conteúdo Obsoleto',
                        declared_needs_review: 'Marcado como Necessitando Revisão',
                        declared_outdated: 'Marcado como Desatualizado',
                      }[item.reasonCode] || item.reasonCode}
                    </span>
                  </div>

                  <h4 className="stale-item-title">
                    <FileText size={15} />
                    <span>{item.itemTitle}</span>
                  </h4>

                  <p className="stale-explanation">{item.explanation}</p>

                  <div className="stale-action-box">
                    <strong>Ação Sugerida:</strong>
                    <p>{item.suggestedAction}</p>
                  </div>

                  <div className="stale-footer">
                    {item.relatedEntity && (
                      <span className="stale-related">
                        Vínculo com {NODE_TYPE_LABEL[item.relatedEntity.type] || item.relatedEntity.type}
                        {item.relatedEntity.title ? `: ${item.relatedEntity.title}` : ''}
                      </span>
                    )}
                    {onNavigateTab && (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => onNavigateTab('library')}
                      >
                        <ExternalLink size={12} />
                        <span>Abrir na Biblioteca</span>
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------------

function GraphLane({
  title,
  icon,
  type,
  count,
  nodes,
  selectedNodeId,
  conflictNodeIds,
  staleItemIds,
  onSelectNode,
}: {
  title: string;
  icon: React.ReactNode;
  type: GraphNodeType;
  count: number;
  nodes: GraphNode[];
  selectedNodeId?: string;
  conflictNodeIds: Set<string>;
  staleItemIds: Set<string>;
  onSelectNode: (node: GraphNode) => void;
}) {
  return (
    <div className={`graph-lane lane-${type}`}>
      <div className="graph-lane-header">
        <div className="lane-header-left">
          {icon}
          <h3>{title}</h3>
        </div>
        <span className="count-badge">{count}</span>
      </div>

      <div className="graph-lane-body">
        {nodes.length === 0 ? (
          <div className="lane-empty">Nenhum nó</div>
        ) : (
          nodes.map(node => {
            const isSelected = node.id === selectedNodeId;
            const hasConflict = conflictNodeIds.has(node.id);
            const isStale = staleItemIds.has(node.id);

            return (
              <button
                key={node.id}
                type="button"
                className={`graph-node-card node-type-${node.type} ${isSelected ? 'is-selected' : ''} ${hasConflict ? 'has-conflict' : ''} ${isStale ? 'has-stale' : ''}`}
                onClick={() => onSelectNode(node)}
              >
                <div className="node-card-top">
                  <span className="node-kind-badge">
                    {NODE_TYPE_LABEL[node.type]}
                  </span>
                  {hasConflict && (
                    <span className="node-alert-dot conflict" title="Participa de conflito de decisão">
                      <ShieldAlert size={11} />
                    </span>
                  )}
                  {isStale && (
                    <span className="node-alert-dot stale" title="Conteúdo desatualizado por decisões">
                      <AlertCircle size={11} />
                    </span>
                  )}
                  <span className="node-status-indicator">
                    {getNodeStatusSnippet(node)}
                  </span>
                </div>

                <div className="node-card-title">{node.label}</div>

                <div className="node-card-footer">
                  <span className="node-id-mono">{node.id.slice(0, 8)}</span>
                  <DateLabel value={node.createdAt} />
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function getNodeStatusSnippet(node: GraphNode): string {
  const data = node.data as any;
  if (node.type === 'decision') {
    if (data.status === 'accepted') return 'Vigente';
    if (data.status === 'proposed') return 'Proposta';
    if (data.status === 'superseded') return 'Substituída';
    if (data.status === 'revoked') return 'Revogada';
  } else if (node.type === 'content') {
    if (data.declaredValidity === 'outdated') return 'Desatualizado';
    if (data.declaredValidity === 'needs_review') return 'Revisar';
    return data.status === 'active' ? 'Ativo' : 'Arquivado';
  } else if (node.type === 'task') {
    if (data.status === 'done') return 'Concluída';
    if (data.status === 'in_progress') return 'Em andamento';
    if (data.status === 'blocked') return 'Bloqueada';
    return 'Pendente';
  } else if (node.type === 'blocker') {
    if (data.status === 'resolved') return 'Resolvido';
    if (data.status === 'mitigated') return 'Mitigado';
    return 'Aberto';
  }
  return '';
}

function NodeTypeBadge({ type }: { type: GraphNodeType }) {
  return (
    <span className={`node-type-badge type-${type}`}>
      {type === 'decision' && <Flag size={11} />}
      {type === 'content' && <FileText size={11} />}
      {type === 'task' && <ListTodo size={11} />}
      {type === 'blocker' && <AlertTriangle size={11} />}
      <span>{NODE_TYPE_LABEL[type]}</span>
    </span>
  );
}

function DecisionNodeDetails({ data }: { data: any }) {
  return (
    <div className="node-meta-grid">
      <div>
        <span>Status</span>
        <strong>
          {{
            accepted: 'Vigente (Aceita)',
            proposed: 'Proposta',
            superseded: 'Substituída',
            revoked: 'Revogada',
          }[data.status as string] || data.status}
        </strong>
      </div>
      <div>
        <span>Versão</span>
        <strong>v{data.version}</strong>
      </div>
      <div>
        <span>Proposta por</span>
        <strong>{data.proposedBy}</strong>
      </div>
      {data.acceptedBy && (
        <div>
          <span>Aceita por</span>
          <strong>{data.acceptedBy}</strong>
        </div>
      )}
      {data.revokedBy && (
        <div>
          <span>Revogada por</span>
          <strong>{data.revokedBy}</strong>
        </div>
      )}
    </div>
  );
}

function ContentNodeDetails({ data }: { data: any }) {
  return (
    <div className="node-meta-grid">
      <div>
        <span>Tipo de Doc</span>
        <strong>{data.kind}</strong>
      </div>
      <div>
        <span>Estado</span>
        <strong>{data.status === 'active' ? 'Ativo' : 'Arquivado'}</strong>
      </div>
      <div>
        <span>Validade</span>
        <strong>
          {{
            valid: 'Válido',
            needs_review: 'Requer revisão',
            outdated: 'Desatualizado',
          }[data.declaredValidity as string] || data.declaredValidity}
        </strong>
      </div>
      <div>
        <span>Versão</span>
        <strong>v{data.version}</strong>
      </div>
    </div>
  );
}

function TaskNodeDetails({ data }: { data: any }) {
  return (
    <div className="node-meta-grid">
      <div>
        <span>Status</span>
        <strong>
          {{
            done: 'Concluída',
            in_progress: 'Em andamento',
            blocked: 'Bloqueada',
            pending: 'Pendente',
          }[data.status as string] || data.status}
        </strong>
      </div>
      <div>
        <span>Prioridade</span>
        <strong>{data.priority || 'medium'}</strong>
      </div>
      <div>
        <span>Responsável</span>
        <strong>{data.assignee || 'Nenhum'}</strong>
      </div>
      <div>
        <span>Dependências</span>
        <strong>{data.dependencyTaskIds?.length || 0}</strong>
      </div>
    </div>
  );
}

function BlockerNodeDetails({ data }: { data: any }) {
  return (
    <div className="node-meta-grid">
      <div>
        <span>Status</span>
        <strong>
          {{
            open: 'Aberto',
            mitigated: 'Mitigado',
            resolved: 'Resolvido',
          }[data.status as string] || data.status}
        </strong>
      </div>
      <div>
        <span>Aberto por</span>
        <strong>{data.openedBy}</strong>
      </div>
      {data.assignee && (
        <div>
          <span>Responsável</span>
          <strong>{data.assignee}</strong>
        </div>
      )}
      {data.resolution && (
        <div className="full-width">
          <span>Desfecho</span>
          <p>{data.resolution}</p>
        </div>
      )}
    </div>
  );
}
