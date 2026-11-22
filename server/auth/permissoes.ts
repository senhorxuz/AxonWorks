import type { RequestHandler } from 'express'
import type { AuthContext, TokenRole } from '../../shared/auth.js'
import { DomainError } from '../store/errors.js'

export const NIVEL_DO_PAPEL: Record<TokenRole, number> = {
  owner: 4,
  collaborator: 3,
  agent: 2,
  observer: 1,
}

export const exigirAdministrador: RequestHandler = (req, _res, next) => {
  const auth = req.auth
  if (auth === undefined || auth.actorType === 'agent' || auth.role !== 'owner' || auth.projectId) {
    throw new DomainError(403, 'so_quem_administra', 'Só quem administra a Axon pode fazer isso.')
  }
  next()
}

export function conferirPermissaoDoToken(
  auth: Pick<AuthContext, 'role' | 'projectId'>, papel: unknown, projeto: unknown,
): void {
  if (typeof papel === 'string' && NIVEL_DO_PAPEL[papel as TokenRole] > NIVEL_DO_PAPEL[auth.role]) {
    throw new DomainError(403, 'token_maior_que_quem_pede', 'O token não pode ter um papel maior que o de quem o solicita.')
  }
  if (auth.projectId && projeto !== auth.projectId) {
    throw new DomainError(403, 'forbidden_project_scope', 'O token deve pertencer ao mesmo projeto de quem o solicita.')
  }
}
