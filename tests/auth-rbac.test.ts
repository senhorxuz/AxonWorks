import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { createMcpServer } from '../server/mcp-tools.js';
import { hashPassword, verifyPassword } from '../server/auth/crypto.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('Etapa 3 — Contas, Dispositivos Pareados, RBAC por Projeto, Tokens Revogáveis e Logs de Auditoria', () => {
  const cleanups: Array<() => void> = [];

  function createTempEnv() {
    const dir = mkdtempSync(path.join(tmpdir(), 'axon-auth-test-'));
    const dbPath = path.join(dir, 'live.sqlite');
    cleanups.push(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });
    return { dir, dbPath };
  }

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()!();
    }
  });

  test('criptografia de senhas com scrypt e salt aleatório contra ataques de timing', () => {
    const hash = hashPassword('minhasenhasecreta123');
    assert.ok(hash.startsWith('scrypt:'));
    assert.equal(verifyPassword('minhasenhasecreta123', hash), true);
    assert.equal(verifyPassword('senhaerrada123', hash), false);
    assert.equal(verifyPassword('', hash), false);
    assert.throws(() => hashPassword('curta'), /no mínimo 8 caracteres/);
  });

  test('gerenciamento de contas: cadastro, unicidade de username, busca e auditoria', () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const account = store.createAccount({
      username: 'operador_alpha',
      displayName: 'Operador Principal',
      password: 'superpassword123',
      role: 'admin',
    });

    assert.equal(account.username, 'operador_alpha');
    assert.equal(account.displayName, 'Operador Principal');
    assert.equal(account.role, 'admin');
    assert.equal(account.status, 'active');

    // Rejeita duplicidade de username
    assert.throws(
      () =>
        store.createAccount({
          username: 'operador_alpha',
          displayName: 'Outro Nome',
          password: 'outrasenha123',
        }),
      (err: unknown) => {
        const error = err as { code?: string };
        assert.equal(error.code, 'username_already_exists');
        return true;
      },
    );

    // Busca por username
    const found = store.getAccountByUsername('operador_alpha');
    assert.ok(found);
    assert.equal(found.id, account.id);
    assert.ok(verifyPassword('superpassword123', found.passwordHash));

    // Auditoria gerada automaticamente
    const logs = store.listAuditLogs({ action: 'auth.account_created' });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.resourceId, account.id);
  });

  test('pareamento e revogação de dispositivos vinculados à conta', () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const account = store.createAccount({
      username: 'device_user',
      displayName: 'Dono do Aparelho',
      password: 'password1234',
    });

    const device = store.pairDevice({
      accountId: account.id,
      deviceName: 'MacBook Pro de Trabalho',
      deviceFingerprint: 'fp_mbp_sec_999',
      ipAddress: '192.168.1.50',
    });

    assert.equal(device.accountId, account.id);
    assert.equal(device.deviceName, 'MacBook Pro de Trabalho');
    assert.equal(device.status, 'active');
    assert.ok(device.pairingCode);

    const devices = store.listPairedDevices(account.id);
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.id, device.id);

    // Revoga o dispositivo
    const revoked = store.revokeDevice(device.id);
    assert.equal(revoked.status, 'revoked');
    assert.ok(revoked.revokedAt);

    // Auditoria de revogação
    const logs = store.listAuditLogs({ action: 'device.revoked' });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.resourceId, device.id);
  });

  test('RBAC por projeto: atribuição, listagem, CAS de papéis e remoção de membros', () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const project = store.createProject({
      name: 'Projeto RBAC',
      objective: 'Validar papéis e permissões por projeto',
    });

    const u1 = store.createAccount({ username: 'colab_1', displayName: 'Colaborador 1', password: 'password123' });
    const u2 = store.createAccount({ username: 'viewer_1', displayName: 'Observador 1', password: 'password123' });

    // Adiciona colaborador
    const m1 = store.addProjectMember(project.id, { accountId: u1.id, role: 'collaborator' });
    assert.equal(m1.role, 'collaborator');
    assert.equal(m1.username, 'colab_1');

    // Adiciona observador
    const m2 = store.addProjectMember(project.id, { accountId: u2.id, role: 'observer' });
    assert.equal(m2.role, 'observer');

    const members = store.listProjectMembers(project.id);
    assert.equal(members.length, 2);

    // Promove colaborador a owner do projeto
    const updated = store.addProjectMember(project.id, { accountId: u1.id, role: 'owner' });
    assert.equal(updated.role, 'owner');
    assert.equal(store.getMemberRole(project.id, u1.id), 'owner');

    // Remove membro
    store.removeProjectMember(project.id, u2.id);
    assert.equal(store.getMemberRole(project.id, u2.id), null);
    assert.equal(store.listProjectMembers(project.id).length, 1);
  });

  test('tokens revogáveis de alta entropia: criação, resolução, escopo de projeto e expiração', () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const project = store.createProject({ name: 'Projeto Token', objective: 'Escopo de token' });

    // Cria token para um agente com escopo restrito
    const result = store.createAuthToken({
      name: 'Token Astra - Projeto Token',
      tokenType: 'agent',
      role: 'collaborator',
      projectId: project.id,
      agentName: 'Astra',
      expiresInHours: 24,
    });

    assert.ok(result.token.startsWith('axon_agt_'));
    assert.equal(result.tokenInfo.name, 'Token Astra - Projeto Token');
    assert.equal(result.tokenInfo.role, 'collaborator');
    assert.equal(result.tokenInfo.projectId, project.id);
    assert.equal(result.tokenInfo.agentName, 'Astra');
    assert.ok(result.tokenInfo.expiresAt);

    // Resolução do token bruto
    const resolved = store.resolveAuthToken(result.token);
    assert.ok(resolved);
    assert.equal(resolved.id, result.tokenInfo.id);
    assert.equal(resolved.agentName, 'Astra');
    assert.ok(resolved.lastUsedAt);

    // Rejeição de token adulterado
    assert.equal(store.resolveAuthToken('axon_agt_invalido123456789'), null);

    // Revogação imediata
    const revoked = store.revokeAuthToken(result.tokenInfo.id, 'admin');
    assert.ok(revoked.revokedAt);
    assert.equal(revoked.revokedBy, 'admin');

    // Token revogado não resolve mais
    assert.equal(store.resolveAuthToken(result.token), null);
  });

  test('endpoints HTTP: autenticação Bearer, login, me, gerenciamento de tokens, membros e auditoria', async () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const app = createApp(store);
    const server = app.listen(0, '127.0.0.1');
    cleanups.push(() => server.close());
    await new Promise((r) => server.once('listening', r));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    const headers = {
      'Content-Type': 'application/json',
      'X-Workspace-Client': 'local',
      Origin: base,
    };

    // 1. POST /api/auth/register
    const regRes = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: 'admin_master',
        displayName: 'Administrador Master',
        password: 'adminpassword123',
        role: 'admin',
      }),
    });
    assert.equal(regRes.status, 201);
    const registered = await regRes.json();
    assert.equal(registered.username, 'admin_master');

    // 2. POST /api/auth/login
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: 'admin_master',
        password: 'adminpassword123',
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.equal(loginData.account.username, 'admin_master');
    // A sessão do navegador agora vem em cookie assinado, não no corpo da resposta.
    const sessao = (loginRes.headers.getSetCookie().find(c => c.startsWith('axon_sessao=')) ?? '').split(';')[0];
    assert.match(sessao, /^axon_sessao=axon_usr_/);

    // 3. GET /api/auth/me usando Bearer token
    const meRes = await fetch(`${base}/api/auth/me`, {
      headers: {
        ...headers,
        Cookie: sessao,
      },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.account.username, 'admin_master');
    assert.equal(meData.auth.role, 'owner');

    // 4. POST /api/auth/tokens (cria token de agente)
    const tokenRes = await fetch(`${base}/api/auth/tokens`, {
      method: 'POST',
      headers: { ...headers, Cookie: sessao },
      body: JSON.stringify({
        name: 'Grok Token',
        tokenType: 'agent',
        role: 'collaborator',
        agentName: 'Grok',
        expiresInHours: 12,
      }),
    });
    assert.equal(tokenRes.status, 201);
    const tokenData = await tokenRes.json();
    assert.ok(tokenData.token);

    // 5. GET /api/audit-logs
    const auditRes = await fetch(`${base}/api/audit-logs`, {
      headers: { ...headers, Cookie: sessao },
    });
    assert.equal(auditRes.status, 200);
    const auditLogs = await auditRes.json();
    assert.ok(Array.isArray(auditLogs));
    assert.ok(auditLogs.length >= 2);
  });

  test('ferramentas MCP: create_auth_token, list_auth_tokens, revoke_auth_token, list_project_members e list_audit_logs', async () => {
    const { dbPath } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const project = store.createProject({ name: 'Projeto MCP Auth', objective: 'Testar MCP Auth' });

    const server = createMcpServer(store);
    const client = new Client({ name: 'mcp-auth-tester', version: '1.0.0' }, { capabilities: {} });
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const toolNames = new Set(tools.tools.map((t) => t.name));
    assert.ok(toolNames.has('create_auth_token'));
    assert.ok(toolNames.has('list_auth_tokens'));
    assert.ok(toolNames.has('revoke_auth_token'));
    assert.ok(toolNames.has('list_project_members'));
    assert.ok(toolNames.has('list_audit_logs'));

    // 1. create_auth_token
    const createCall = await client.callTool({
      name: 'create_auth_token',
      arguments: {
        name: 'MCP Scoped Agent',
        tokenType: 'agent',
        role: 'agent',
        projectId: project.id,
        agentName: 'Gemini',
      },
    });
    assert.equal(createCall.isError, undefined);
    const createdResult = JSON.parse((createCall.content as Array<{ text: string }>)[0]!.text);
    assert.ok(createdResult.token.startsWith('axon_agt_'));

    // 2. list_auth_tokens
    const listCall = await client.callTool({
      name: 'list_auth_tokens',
      arguments: { projectId: project.id },
    });
    const list = JSON.parse((listCall.content as Array<{ text: string }>)[0]!.text);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, createdResult.tokenInfo.id);

    // 3. revoke_auth_token
    const revokeCall = await client.callTool({
      name: 'revoke_auth_token',
      arguments: { tokenId: createdResult.tokenInfo.id, revokedBy: 'operator' },
    });
    assert.equal(revokeCall.isError, undefined);
    const revoked = JSON.parse((revokeCall.content as Array<{ text: string }>)[0]!.text);
    assert.ok(revoked.revokedAt);

    // 4. list_audit_logs
    const auditCall = await client.callTool({
      name: 'list_audit_logs',
      arguments: { limit: 10 },
    });
    const auditLogs = JSON.parse((auditCall.content as Array<{ text: string }>)[0]!.text);
    assert.ok(auditLogs.length >= 2);
  });
});
