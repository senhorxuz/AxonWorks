export type AccountRole = 'admin' | 'user';
export type AccountStatus = 'active' | 'suspended';

export interface Account {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export type DeviceStatus = 'pending' | 'active' | 'revoked';

export interface PairedDevice {
  id: string;
  accountId: string;
  deviceName: string;
  deviceFingerprint: string;
  pairingCode?: string | null;
  status: DeviceStatus;
  ipAddress?: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt?: string | null;
}

export type ProjectRole = 'owner' | 'collaborator' | 'observer';

export interface ProjectMember {
  projectId: string;
  accountId: string;
  role: ProjectRole;
  username?: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export type TokenType = 'user_session' | 'agent' | 'device';
export type TokenRole = 'owner' | 'collaborator' | 'observer' | 'agent';

export interface AuthToken {
  id: string;
  accountId?: string | null;
  tokenPrefix: string;
  name: string;
  tokenType: TokenType;
  role: TokenRole;
  projectId?: string | null;
  agentName?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  revokedBy?: string | null;
}

export interface CreatedTokenResult {
  token: string;
  tokenInfo: AuthToken;
}

export type ActorType = 'user' | 'agent' | 'device' | 'system' | 'anonymous';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  projectId?: string | null;
  ipAddress?: string | null;
  status: 'success' | 'denied' | 'error';
  details: Record<string, unknown>;
}

export interface AuthContext {
  accountId?: string;
  actorType: ActorType;
  actorId: string;
  role: TokenRole;
  projectId?: string | null;
  tokenType?: TokenType;
  tokenId?: string;
}
