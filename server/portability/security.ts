import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

const FORBIDDEN_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.cert',
  '.crt',
  '.pfx',
  '.p12',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.db3',
])

const FORBIDDEN_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '.axon',
])

const FORBIDDEN_EXACT_FILENAMES = new Set([
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  'known_hosts',
  'authorized_keys',
  'credentials',
  'credentials.json',
  'passwd',
  'shadow',
  '.htpasswd',
])

const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

/**
 * Máscara de segredos em modo best-effort.
 * Não garante prevenção universal (DLP), mas mitiga exposição de padrões comuns de credenciais.
 */
export function maskSecrets(text: string): string {
  if (!text) return text
  return text
    // URLs com usuário e senha
    .replace(/:\/\/([^/\s:@]+):([^/\s@]+)@/g, '://***:***@')
    // Tokens de autenticação Bearer
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer ***')
    // Bloco de chaves privadas PEM
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[CHAVE PRIVADA MASCARADA]')
    // Padrões de chaves de API comuns
    .replace(/\b((?:[A-Za-z_][A-Za-z0-9_]*)?(?:API_KEY|APIKEY|ACCESS_KEY|SECRET|TOKEN))\s*[=:]\s*["']?[^\s"']+["']?/gi, '$1=***')
    // Padrões de senhas
    .replace(/\b(PASSWORD|passwd|pwd)\s*[=:]\s*["']?[^\s"']+["']?/gi, '$1=***')
    // Chaves AWS Access Key ID
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***')
    // Tokens GitHub
    .replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g, '$1_***')
    // Tokens GitLab
    .replace(/\bglpat-[A-Za-z0-9\-_]{20,}\b/g, 'glpat-***')
    // Tokens Slack
    .replace(/\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/g, 'xox*-***')
}

export interface PathValidationResult {
  safe: boolean
  reason?: string
}

/**
 * Valida se um caminho de arquivo relativo é seguro para leitura sob o workspace.
 * Rejeita path traversal, caminhos absolutos, ADS Windows, UNC/device paths e arquivos de blacklist.
 */
export function validateRelativeFilePath(filePath: string): PathValidationResult {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return { safe: false, reason: 'Caminho de arquivo vazio ou inválido.' }
  }

  const trimmed = filePath.trim()

  // Rejeita byte nulo e caracteres de controle
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return { safe: false, reason: 'Caminho contém caracteres de controle ou byte nulo proibidos.' }
  }

  // Rejeita caminhos absolutos no formato Unix ou Windows (ex: /etc, \Windows, C:\foo)
  if (isAbsolute(trimmed) || /^[a-zA-Z]:[/\\]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return { safe: false, reason: 'Caminhos absolutos são proibidos na inspeção seletiva.' }
  }

  // Rejeita UNC paths (\\servidor\share ou //servidor/share) e caminhos de dispositivo Windows (\\?\, \\.\)
  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    return { safe: false, reason: 'Caminhos UNC ou de dispositivo são proibidos.' }
  }

  // Rejeita Alternate Data Streams (ADS) do NTFS do Windows (ex: arquivo.txt:stream ou::$DATA)
  // Colons são proibidos em caminhos relativos
  if (trimmed.includes(':')) {
    return { safe: false, reason: 'Fluxos de dados alternativos (ADS) do Windows são proibidos.' }
  }

  // Normalização de separadores para divisão em segmentos
  const normalized = normalize(trimmed).replace(/\\/g, '/')
  const segments = normalized.split('/').filter(s => s.length > 0)

  if (segments.length === 0) {
    return { safe: false, reason: 'Caminho não contém segmentos válidos.' }
  }

  // Análise segmento a segmento
  for (const segment of segments) {
    // Rejeita path traversal
    if (segment === '..' || segment === '.') {
      return { safe: false, reason: 'Tentativa de path traversal detectada.' }
    }

    const lowerSegment = segment.toLowerCase()

    // Rejeita pastas restritas
    if (FORBIDDEN_SEGMENTS.has(lowerSegment)) {
      return { safe: false, reason: `Acesso a '${segment}' é estritamente proibido pela blacklist de segurança.` }
    }

    // Rejeita arquivos .env (ex: .env, .env.local, .env.production)
    if (lowerSegment === '.env' || lowerSegment.startsWith('.env.')) {
      return { safe: false, reason: 'Arquivos de variáveis de ambiente (.env) são bloqueados por segurança.' }
    }

    // Rejeita dispositivos reservados do Windows (CON, NUL, AUX, PRN, COM1-9, LPT1-9)
    const segmentNameOnly = lowerSegment.split('.')[0]
    if (WINDOWS_RESERVED_NAMES.has(segmentNameOnly)) {
      return { safe: false, reason: `Nome de dispositivo reservado do Windows detectado: '${segment}'.` }
    }
  }

  const fileName = segments[segments.length - 1]
  const lowerFileName = fileName.toLowerCase()

  // Rejeita arquivos de credenciais conhecidos
  if (FORBIDDEN_EXACT_FILENAMES.has(lowerFileName) || lowerFileName.startsWith('id_') || lowerFileName.startsWith('service-account')) {
    return { safe: false, reason: `Arquivo de credenciais ou chave sensível bloqueado: '${fileName}'.` }
  }

  // Rejeita extensões proibidas (chaves, certificados, bancos sqlite)
  for (const ext of FORBIDDEN_EXTENSIONS) {
    if (lowerFileName.endsWith(ext)) {
      return { safe: false, reason: `Extensão de arquivo proibida por segurança: '${ext}'.` }
    }
  }

  return { safe: true }
}

/**
 * Valida o workspacePath absoluto.
 */
export function validateWorkspacePath(workspacePath: string): PathValidationResult {
  if (typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
    return { safe: false, reason: 'Caminho do workspace é obrigatório.' }
  }

  const trimmed = workspacePath.trim()

  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return { safe: false, reason: 'Caminho do workspace contém caracteres inválidos.' }
  }

  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    return { safe: false, reason: 'Caminhos UNC ou de dispositivo não são aceitos para workspace.' }
  }

  if (!isAbsolute(trimmed)) {
    return { safe: false, reason: 'O caminho do workspace deve ser absoluto.' }
  }

  return { safe: true }
}

/**
 * Verifica se um caminho canônico (realpath) de destino está estritamente contido dentro do root canônico.
 * Previne fuga por symlinks (link escape).
 */
export function isContainedInRoot(canonicalRoot: string, canonicalTarget: string): boolean {
  const normRoot = resolve(canonicalRoot)
  const normTarget = resolve(canonicalTarget)

  // Em Windows, comparação de caminhos é case-insensitive para letras de unidade e caminhos
  const isWindows = process.platform === 'win32'
  const rootComp = isWindows ? normRoot.toLowerCase() : normRoot
  const targetComp = isWindows ? normTarget.toLowerCase() : normTarget

  if (targetComp === rootComp) {
    return true
  }

  const rootPrefix = rootComp.endsWith(sep) ? rootComp : rootComp + sep
  if (!targetComp.startsWith(rootPrefix)) {
    return false
  }

  const rel = relative(rootComp, targetComp)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Detecta se um buffer representa conteúdo binário (ex: contém bytes nulos).
 */
export function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLen = Math.min(buffer.length, 8192)
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0x00) {
      return true
    }
  }
  return false
}
