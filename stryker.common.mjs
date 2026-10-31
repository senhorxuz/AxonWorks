/**
 * O que as configurações de mutação (stryker.<apelido>.config.mjs) têm em comum.
 * Uma fatia = um ou mais módulos a mutar + os arquivos de teste que os cobrem.
 * Rodar uma fatia (da raiz do projeto, depois de `npm install`):
 *   node ./node_modules/@stryker-mutator/core/bin/stryker.js run stryker.<apelido>.config.mjs
 * (nunca `npx stryker`: resolve para um pacote legado).
 *
 * Por que o executor "command": os testes da Axon usam `node:test` via tsx, e o Stryker não tem
 * executor para isso. O "command" roda, uma vez por mutante, só os arquivos de teste da fatia e
 * olha o código de saída (0 = o mutante sobreviveu; diferente de 0 = morto). É mais devagar que um
 * executor nativo, mas dá o número certo e não depende do nome dos testes.
 *
 * Regra do padrão ouro: mutação só na fatia nova (nunca o código inteiro). Timeout conta como morto.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Caminho absoluto do tsx, a partir da pasta deste arquivo (não da cópia do Stryker): numa pasta de
// trabalho (git worktree) o `node_modules` é um link (junction) que o Stryker não leva para a cópia.
const TSX_CLI = join(dirname(fileURLToPath(import.meta.url)), 'node_modules', 'tsx', 'dist', 'cli.mjs')

export function slice({ name, mutate, tests }) {
  return {
    mutate,
    testRunner: 'command',
    commandRunner: {
      // Um processo de teste por mutante, só os arquivos da fatia (sem shell, funciona igual no Windows e na VPS).
      command: `node ${TSX_CLI} --test --test-concurrency=1 ${tests.join(' ')}`,
    },
    // O executor "command" não mede cobertura por teste: cada mutante roda a fatia inteira.
    coverageAnalysis: 'off',
    // Dois mutantes ao mesmo tempo, cada um com um processo de teste.
    concurrency: 2,
    // Um mutante que faz um laço girar sem fim é morto por tempo (conta como morto).
    timeoutMS: 120000,
    reporters: ['clear-text', 'progress'],
    tempDirName: `.stryker-tmp/${name}`,
    cleanTempDir: true,
    // O número é lido por quem roda; nenhum limite derruba o comando.
    thresholds: { high: 100, low: 100, break: null },
    disableTypeChecks: false,
    // O Stryker reescreve o tsconfig da cópia com `ts.parseConfigFileTextToJson`, que o TypeScript 7
    // (o do projeto) não tem mais. Apontando para um arquivo que não existe, essa etapa é pulada; a
    // cópia leva o tsconfig como está, e o tsx não precisa que ele seja reescrito.
    tsconfigFile: 'stryker-sem-tsconfig.json',
    // Só o que os testes usam vai para a cópia. Bancos locais, dados da Axon, saídas de teste, cópias de outras
    // rodadas e segredos nunca vão: a mutação copia a pasta para um diretório temporário.
    ignorePatterns: [
      '/.axon',
      '/output',
      '/node_modules/.cache',
      '/.stryker-tmp',
      '/dist',
      '/dist-server',
      '/.claude',
      '/coverage',
      '/test-results',
      '/playwright-report',
      '.env',
      '.env.*',
      '*.sqlite*',
    ],
  }
}
