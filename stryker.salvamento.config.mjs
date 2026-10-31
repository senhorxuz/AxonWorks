import { slice } from './stryker.common.mjs'

// Fatia do salvamento de compactação (lote 2, D5): a regra (server/store/salvamento.ts) e só as linhas
// da ligação nos arquivos antigos (store, leitura da linha, colunas novas, carta "Onde paramos").
// As faixas de linhas foram recalculadas depois da junção das três frentes do lote 2 e da revisão da onda 1
// (o salvamento viaja no pacote v3). Se uma linha acima delas mudar, recalcule.
export default slice({
  name: 'salvamento',
  mutate: [
    'server/store/salvamento.ts',
    // gravação: os dois métodos públicos, a carga canônica, o INSERT e os valores das colunas novas
    'server/store.ts:1373-1384',
    'server/store.ts:1411-1413',
    'server/store.ts:1448-1451',
    'server/store.ts:1468-1469',
    // importação: leitura do kind/extras do registro, o INSERT e a carga canônica do checkpoint importado
    'server/store.ts:4379-4379',
    'server/store.ts:4525-4528',
    'server/store.ts:4544-4546',
    'server/store.ts:4562-4563',
    // leitura: os quatro SELECT de checkpoint ganharam kind e extras_json
    'server/store.ts:5684-5686',
    'server/store.ts:5798-5800',
    'server/store.ts:5821-5823',
    'server/store.ts:5929-5931',
    'server/store/mappers.ts:412-412',
    'server/store/schema.ts:477-478',
    'server/carta/montar.ts:279-300',
    'server/carta/montar.ts:316-316',
  ],
  tests: ['tests/salvamento.test.ts', 'tests/carta-montar.test.ts', 'tests/carta-ler.test.ts'],
})
