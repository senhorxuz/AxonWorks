/**
 * Perfil do servidor MCP: quais tools este processo oferece às IAs.
 *
 * - `full` (padrão): todas as tools. Nenhuma tool deixa de existir.
 * - `essential`: só o ciclo de trabalho de uma IA (entrar, trabalhar, sair).
 *   Serve para clientes que carregam a lista inteira no início de cada sessão
 *   e se confundem com muitas opções. Ligue com AXON_MCP_PROFILE=essential.
 */
export type McpProfile = 'essential' | 'full';

export const ESSENTIAL_MCP_TOOLS: ReadonlySet<string> = new Set([
  // Entrar
  'list_projects',
  'search_projects',
  'get_project',
  'get_resume_brief',
  'get_charter',
  'acknowledge_handoff_delivery',
  'acknowledge_message',
  'resolve_message_attention',
  'claim_task',
  // Trabalhar
  'send_message',
  'save_work_draft',
  'open_blocker',
  'resolve_blocker',
  'create_backlog_item',
  'propose_approval',
  'propose_decision',
  'get_project_insights',
  'search_content',
  'list_evidence',
  'cross_check_evidence',
  'get_board',
  'create_board_card',
  'update_board_card',
  'move_board_card',
  // Sair
  'save_checkpoint',
  'finalize_work',
]);

export function parseMcpProfile(value: string | undefined): McpProfile {
  if (value === undefined) return 'full';
  if (value === 'essential' || value === 'full') return value;
  throw new Error(`AXON_MCP_PROFILE deve ser "essential" ou "full" (recebido: "${value}").`);
}
