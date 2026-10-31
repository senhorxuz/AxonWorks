import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-tools.js';
import { WorkspaceStore } from './store.js';
import { dbPath } from './config.js';
import { parseMcpProfile } from './mcp-profile.js';
// Lido antes de abrir o banco: um perfil inválido derruba o processo com mensagem clara.
const profile = parseMcpProfile(process.env.AXON_MCP_PROFILE);
mkdirSync(path.dirname(dbPath), { recursive: true });
const store = new WorkspaceStore(dbPath);
const server = createMcpServer(store, { profile });
// stdout belongs exclusively to the MCP protocol.
await server.connect(new StdioServerTransport());
server.server.onclose = () => store.close();
