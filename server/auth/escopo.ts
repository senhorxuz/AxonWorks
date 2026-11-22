// Escopo do projeto: um token restrito a um projeto (auth.projectId) não lê nem escreve em outro projeto.
// Vale para toda rota /api/projects/:id/*, ligada uma vez em `server/app.ts`, logo depois da autenticação.
// Achado da revisão de segurança de 21/11/2026: a conferência existia em `requireProjectRole`, mas nenhuma rota a usava.
import type { NextFunction, Request, Response } from 'express'
import type { AuthContext } from '../../shared/auth.js'

/** O token pode agir no projeto? Sem token restrito (operador local, dono, token sem projeto), pode. */
export function podeAgirNoProjeto(auth: Pick<AuthContext, 'projectId'> | undefined, projectId: string): boolean {
  return !auth?.projectId || auth.projectId === projectId
}

/** Middleware: recusa com 403 forbidden_project_scope a rota de outro projeto. */
export function exigirEscopoDoProjeto(req: Request, res: Response, next: NextFunction): void {
  // Ligado em '/api/projects/:id': o Express sempre preenche `id` com texto nessa rota.
  if (!podeAgirNoProjeto(req.auth, req.params.id as string)) {
    res.status(403).json({
      error: { code: 'forbidden_project_scope', message: 'Este token não possui permissão para acessar este projeto.' },
    })
    return
  }
  next()
}
