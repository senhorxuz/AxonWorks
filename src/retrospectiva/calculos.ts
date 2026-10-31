import type { Decision } from '../../shared/continuity';
import type { ProjectDetail } from '../../shared/types';

/**
 * Cálculos da Retrospectiva. Funções puras sobre dados que o app já tem:
 * nada é estimado, arredondado para parecer melhor ou inventado quando falta.
 * Datas são agrupadas pelo dia local de quem está olhando.
 */

/** Um checkpoint na trilha: posicao vai de 0 (o primeiro) a 1 (o mais recente), pelo tempo real. */
export interface PontoDaTrilha {
  checkpointId: string;
  posicao: number;
  agente: string;
  criadoEm: string;
  resumo: string;
  fraseSimples?: string;
  tarefaConcluida?: { id: string; titulo: string };
}

export interface Trilha {
  inicio: string;
  fim: string;
  pontos: PontoDaTrilha[];
  /** Quanto tempo se passou do último checkpoint até agora. */
  semCheckpointHaMs: number;
}

export interface Entrega {
  tarefaId: string;
  titulo: string;
  agente: string;
  concluidaEm: string;
  checkpointId: string;
  fraseSimples?: string;
  resumoTecnico: string;
}

export interface Retrospectiva {
  tarefasConcluidas: number;
  checkpoints: number;
  diasDeTrabalho: number;
  trilha: Trilha | null;
  semanaMaisProdutiva: { inicio: string; fim: string; entregas: number } | null;
  entregas: Entrega[];
  porAgente: Array<{ agente: string; entregas: number; checkpoints: number }>;
}

export function chaveDoDia(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

function somarDias(data: Date, dias: number): Date {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate() + dias, 12);
}

function segundaDaSemana(data: Date): Date {
  return somarDias(data, -((data.getDay() + 6) % 7));
}

export function calcularRetrospectiva(detail: ProjectDetail, agora: Date): Retrospectiva {
  const checkpointsPorId = new Map(detail.checkpoints.map(cp => [cp.id, cp]));

  const porDia = new Map<string, number>();
  for (const cp of detail.checkpoints) {
    const chave = chaveDoDia(new Date(cp.createdAt));
    porDia.set(chave, (porDia.get(chave) ?? 0) + 1);
  }

  const entregas: Entrega[] = [];
  for (const tarefa of detail.tasks) {
    if (tarefa.status !== 'done' || !tarefa.completionCheckpointId) continue;
    const cp = checkpointsPorId.get(tarefa.completionCheckpointId);
    if (!cp) continue;
    entregas.push({
      tarefaId: tarefa.id,
      titulo: tarefa.title,
      agente: cp.agent,
      concluidaEm: cp.createdAt,
      checkpointId: cp.id,
      ...(cp.humanSummary ? { fraseSimples: cp.humanSummary } : {}),
      resumoTecnico: cp.summary,
    });
  }
  entregas.sort((a, b) => new Date(b.concluidaEm).getTime() - new Date(a.concluidaEm).getTime());

  const tarefaPorCheckpoint = new Map(entregas.map(e => [e.checkpointId, { id: e.tarefaId, titulo: e.titulo }]));
  const ordenados = [...detail.checkpoints].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.revision - b.revision);
  let trilha: Trilha | null = null;
  if (ordenados.length > 0) {
    const tInicio = new Date(ordenados[0]!.createdAt).getTime();
    const tFim = new Date(ordenados.at(-1)!.createdAt).getTime();
    const duracao = tFim - tInicio;
    trilha = {
      inicio: ordenados[0]!.createdAt,
      fim: ordenados.at(-1)!.createdAt,
      semCheckpointHaMs: Math.max(0, agora.getTime() - tFim),
      pontos: ordenados.map(cp => {
        const tarefa = tarefaPorCheckpoint.get(cp.id);
        return {
          checkpointId: cp.id,
          posicao: duracao > 0 ? (new Date(cp.createdAt).getTime() - tInicio) / duracao : 1,
          agente: cp.agent,
          criadoEm: cp.createdAt,
          resumo: cp.summary,
          ...(cp.humanSummary ? { fraseSimples: cp.humanSummary } : {}),
          ...(tarefa ? { tarefaConcluida: tarefa } : {}),
        };
      }),
    };
  }

  const agentes = new Map<string, { agente: string; entregas: number; checkpoints: number }>();
  const doAgente = (nome: string) => {
    let registro = agentes.get(nome);
    if (!registro) { registro = { agente: nome, entregas: 0, checkpoints: 0 }; agentes.set(nome, registro); }
    return registro;
  };
  for (const cp of detail.checkpoints) doAgente(cp.agent).checkpoints += 1;
  for (const entrega of entregas) doAgente(entrega.agente).entregas += 1;
  const porAgente = [...agentes.values()].sort((a, b) =>
    b.checkpoints - a.checkpoints || b.entregas - a.entregas || a.agente.localeCompare(b.agente, 'pt-BR'));

  const semanas = new Map<string, number>();
  for (const entrega of entregas) {
    const chave = chaveDoDia(segundaDaSemana(new Date(entrega.concluidaEm)));
    semanas.set(chave, (semanas.get(chave) ?? 0) + 1);
  }
  let semanaMaisProdutiva: Retrospectiva['semanaMaisProdutiva'] = null;
  if (semanas.size > 1) {
    const [inicio, total] = [...semanas.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]!;
    const [ano, mes, dia] = inicio.split('-').map(Number);
    semanaMaisProdutiva = { inicio, fim: chaveDoDia(somarDias(new Date(ano!, mes! - 1, dia!, 12), 6)), entregas: total };
  }

  return {
    tarefasConcluidas: detail.tasks.filter(t => t.status === 'done').length,
    checkpoints: detail.checkpoints.length,
    diasDeTrabalho: porDia.size,
    trilha,
    semanaMaisProdutiva,
    entregas,
    porAgente,
  };
}

export type SituacaoDaDecisao = 'vale-hoje' | 'substituida' | 'revogada';

export interface DecisaoDoRumo {
  id: string;
  titulo: string;
  corpo: string;
  situacao: SituacaoDaDecisao;
  data: string;
  trocadaPor?: string;
}

/** Decisões que já fizeram parte do rumo, em ordem. Propostas ainda não aceitas ficam de fora. */
export function decisoesDoRumo(decisoes: Decision[]): DecisaoDoRumo[] {
  const titulos = new Map(decisoes.map(d => [d.id, d.title]));
  const situacoes: Partial<Record<Decision['status'], SituacaoDaDecisao>> = {
    accepted: 'vale-hoje',
    superseded: 'substituida',
    revoked: 'revogada',
  };
  return decisoes
    .filter(d => situacoes[d.status])
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(d => {
      const trocadaPor = d.supersededById ? titulos.get(d.supersededById) : undefined;
      return {
        id: d.id,
        titulo: d.title,
        corpo: d.body,
        situacao: situacoes[d.status]!,
        data: d.createdAt,
        ...(trocadaPor ? { trocadaPor } : {}),
      };
    });
}
