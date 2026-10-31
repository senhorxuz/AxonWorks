import { hostPermitido } from '../rede.js';
import { lerCookie, NOME_COOKIE } from '../sessao.js';
import type { Request, Response, NextFunction } from 'express';
import type { WorkspaceStore } from '../store.js';
import type { AuthContext, ProjectRole, TokenRole } from '../../shared/auth.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const ROLE_HIERARCHY: Record<TokenRole, number> = {
  owner: 4,
  collaborator: 3,
  agent: 2,
  observer: 1,
};

export function createAuthMiddleware(store: WorkspaceStore, hostsPermitidos: readonly string[] = [], exigirLogin = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Extração do token: cookie da sessão (navegador), Bearer ou cabeçalho personalizado
    const authHeader = req.headers.authorization;
    let rawToken: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      rawToken = authHeader.slice(7).trim();
    } else if (typeof req.headers['x-axon-token'] === 'string') {
      rawToken = req.headers['x-axon-token'].trim();
    } else {
      rawToken = lerCookie(req.headers.cookie, NOME_COOKIE);
    }

    if (rawToken) {
      const resolved = store.resolveAuthToken(rawToken);
      if (!resolved) {
        res.status(401).json({
          error: { code: 'unauthorized', message: 'Token de autenticação inválido, expirado ou revogado.' },
        });
        return;
      }

      req.auth = {
        accountId: resolved.accountId ?? undefined,
        actorType: resolved.tokenType === 'agent' ? 'agent' : 'user',
        actorId: resolved.agentName ?? resolved.accountId ?? 'token-user',
        role: resolved.role,
        projectId: resolved.projectId,
        tokenType: resolved.tokenType,
        tokenId: resolved.id,
      };
      next();
      return;
    }

    // 2. Se nenhum token foi enviado:
    // Sem estas rotas livres ninguém consegue entrar: saúde (monitoramento), a pergunta
    // que decide qual tela mostrar, o login, a saída e a criação da primeira conta.
    const rotaLivre =
      (req.method === 'GET' && req.path === '/health') ||
      (req.method === 'GET' && req.path === '/auth/status') ||
      (req.method === 'POST' && req.path === '/auth/login') ||
      (req.method === 'POST' && req.path === '/auth/logout') ||
      (req.method === 'POST' && req.path === '/auth/register' && store.listAccounts().length === 0);
    if ((exigirLogin || process.env.AXON_REQUIRE_AUTH === '1') && !rotaLivre) {
      res.status(401).json({
        error: { code: 'authentication_required', message: 'Autenticação obrigatória. Forneça um Bearer token.' },
      });
      return;
    }

    // Modo local transparente (retrocompatibilidade com testes e local CLI):
    const host = req.headers.host ?? '';
    const isLocal = hostPermitido(host, hostsPermitidos);
    if (isLocal && req.headers['x-workspace-client'] === 'local') {
      req.auth = {
        actorType: 'anonymous',
        actorId: 'local-operator',
        role: 'owner',
        projectId: null,
      };
    }

    next();
  };
}

export function requireAuth() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        error: { code: 'unauthorized', message: 'Acesso não autenticado.' },
      });
      return;
    }
    next();
  };
}

export function requireProjectRole(store: WorkspaceStore, minRole: ProjectRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        error: { code: 'unauthorized', message: 'Acesso não autenticado.' },
      });
      return;
    }

    const rawParam = req.params.id ?? req.params.projectId ?? req.body?.projectId;
    const projectId = typeof rawParam === 'string' ? rawParam : undefined;
    if (!projectId) {
      next();
      return;
    }

    // Se o token estiver restrito a um projeto específico, valida o escopo
    if (req.auth.projectId && req.auth.projectId !== projectId) {
      res.status(403).json({
        error: {
          code: 'forbidden_project_scope',
          message: 'Este token não possui permissão para acessar este projeto.',
        },
      });
      return;
    }

    // Operadores locais ou donos têm acesso irrestrito
    if (req.auth.role === 'owner') {
      next();
      return;
    }

    // Se houver uma conta de usuário associada, verifica o membership do projeto
    if (req.auth.accountId) {
      const memberRole = store.getMemberRole(projectId, req.auth.accountId);
      if (memberRole) {
        if (ROLE_HIERARCHY[memberRole] >= ROLE_HIERARCHY[minRole]) {
          next();
          return;
        }
      }
    }

    // Verifica a permissão do próprio token
    if (ROLE_HIERARCHY[req.auth.role] >= ROLE_HIERARCHY[minRole]) {
      next();
      return;
    }

    res.status(403).json({
      error: {
        code: 'insufficient_permissions',
        message: `Permissão insuficiente. Nível mínimo exigido: '${minRole}'.`,
      },
    });
  };
}
