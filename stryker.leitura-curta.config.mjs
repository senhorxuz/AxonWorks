import { slice } from './stryker.common.mjs'

// Fatia da leitura curta: a regra de ordem, orçamento, lacuna e autoridade (`leitura-curta.ts`) e as recusas
// da porta de entrada (`leitura-curta-entrada.ts`) e a escolha do registro mais recente (`leitura-curta-ler.ts`). Texto puro de tela e as ligações ficam de fora.
const tests = [
  'tests/leitura-curta.test.ts',
  'tests/leitura-curta-entrada.test.ts',
  'tests/leitura-curta-ler.test.ts',
  'tests/mudancas-ligacao.test.ts',
]

export default {
  ...slice({
    name: 'leitura-curta',
    mutate: ['server/carta/leitura-curta.ts', 'server/carta/leitura-curta-entrada.ts', 'server/carta/leitura-curta-ler.ts'],
    tests,
  }),
  commandRunner: {
    // O Stryker já abre um processo novo por mutante. Os testes da fatia podem compartilhar o carregador do TSX.
    command: `node --import ${import.meta.resolve('tsx')} --test --test-isolation=none --test-concurrency=1 ${tests.join(' ')}`,
  },
}
