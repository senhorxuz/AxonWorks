import type { KeyboardEvent, ReactNode } from 'react';
import type { DiaDoFeito, LinhaDoFeito, ListaDoFeito, MesDoFeito } from './dias';
import { lide } from './lide';
import { Rolagem } from './Rolagem';
import { assinaturaDaLinha, assinaturaDoDia, dataDoDia, diaDaSemana, horaDaLinha, repeteAManchete } from './rotulos-do-feito';
import { contar, rotuloDoMes } from './texto';

/**
 * "O que foi feito": o mesmo fio, agora de cima para baixo.
 *
 * Só o dia de "onde paramos" começa aberto; cada outro dia é uma linha com a última afirmação dele. Dentro do dia,
 * cada coisa é uma linha que abre ao clicar. A regra mora em ./dias.ts, ./lide.ts e ./rotulos-do-feito.ts.
 */

const SIMBOLO = { tarefa: '●', cartao: '◆', registro: '○' } as const;

/** O que a tela guarda sobre a lista: o que está aberto, o que está aceso e o que acabou de ser alcançado. */
export interface ControleDoFeito {
  abertos: ReadonlySet<string>;
  aoAbrir: (chave: string, aberto: boolean) => void;
  linhasAbertas: ReadonlySet<string>;
  aoAbrirLinha: (chave: string, aberta: boolean) => void;
  /** A coisa que está com o mouse ou o foco no fio: a linha dela acende. */
  chaveAcesa: string | null;
  aoApontar: (chave: string | null) => void;
  /** A linha que um clique acabou de alcançar: fica destacada por um instante. */
  chegou: string | null;
}

export const chaveDoMes = (mes: string) => `mes:${mes}`;

export function ColunaFeito(props: { lista: ListaDoFeito; total: number; manchete: string | null; controle: ControleDoFeito; rascunho: ReactNode; vazio: boolean }) {
  const { lista, total, manchete, controle, rascunho, vazio } = props;
  const doDia = (dia: DiaDoFeito) => <Dia key={dia.dia} dia={dia} agora={lista.chaveDeOndeParamos} manchete={manchete} controle={controle} />;
  return (
    <section className="carta-bloco carta-coluna carta-bloco-feito" aria-labelledby="carta-feito-titulo">
      <header className="coluna-topo">
        <h3 id="carta-feito-titulo">O que foi feito</h3>
        {total > 0 && <span className="coluna-conta">{contar(total, 'coisa', 'coisas')}</span>}
      </header>
      <Rolagem rotulo="O que foi feito">
        {rascunho}
        {lista.recentes.map(doDia)}
        {lista.meses.map(mes => <Mes key={mes.mes} mes={mes} controle={controle}>{mes.dias.map(doDia)}</Mes>)}
        {vazio && <p className="carta-vazio">Nada concluído registrado ainda. Quando um cartão for concluído ou uma IA salvar um registro, o que foi feito aparece aqui.</p>}
      </Rolagem>
    </section>
  );
}

function Mes({ mes, controle, children }: { mes: MesDoFeito; controle: ControleDoFeito; children: ReactNode }) {
  const chave = chaveDoMes(mes.mes);
  return (
    <details className="carta-mes" open={controle.abertos.has(chave)} onToggle={evento => controle.aoAbrir(chave, evento.currentTarget.open)}>
      <summary>{rotuloDoMes({ mes: mes.mes, itens: { length: mes.quantidade } })}</summary>
      {children}
    </details>
  );
}

function Dia({ dia, agora, manchete, controle }: { dia: DiaDoFeito; agora: string | null; manchete: string | null; controle: ControleDoFeito }) {
  const { coisas, familias } = assinaturaDoDia(dia);
  const semana = diaDaSemana(dia.dia);
  return (
    <details className="feito-dia" open={controle.abertos.has(dia.dia)} onToggle={evento => controle.aoAbrir(dia.dia, evento.currentTarget.open)}>
      <summary>
        <span className="feito-data">{dataDoDia(dia.dia)}{semana && <i>{semana}</i>}</span>
        <span className="feito-fecho">{dia.fecho}</span>
        <span className="feito-quem">{coisas}{familias && <> · <b>{familias}</b></>}</span>
      </summary>
      <div className="feito-linhas">
        {dia.linhas.map(linha => linha.chave === agora
          ? <LinhaDeOndeParamos key={linha.chave} linha={linha} manchete={manchete} controle={controle} />
          : <Linha key={linha.chave} linha={linha} controle={controle} />)}
      </div>
    </details>
  );
}

function classesDaLinha(linha: LinhaDoFeito, controle: ControleDoFeito, extra: string): string {
  return ['feito-linha', `feito-${linha.tipo}`, extra, controle.chaveAcesa === linha.chave ? 'feito-ligada' : '', controle.chegou === linha.chave ? 'carta-chegou' : ''].filter(Boolean).join(' ');
}

function Texto({ texto }: { texto: string }) {
  const [destaque, resto] = lide(texto);
  return resto ? <><b>{destaque}</b> {resto}</> : <span className="feito-inteiro">{destaque}</span>;
}

/** Uma coisa feita: uma linha só; clicar (ou Enter, ou Espaço) abre o texto inteiro, com o tipo e quem fez embaixo. */
function Linha({ linha, controle }: { linha: LinhaDoFeito; controle: ControleDoFeito }) {
  const aberta = controle.linhasAbertas.has(linha.chave);
  const assinatura = assinaturaDaLinha(linha);
  const alternar = () => controle.aoAbrirLinha(linha.chave, !aberta);
  const aoTeclar = (evento: KeyboardEvent) => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return;
    evento.preventDefault();
    alternar();
  };
  return (
    <div className={classesDaLinha(linha, controle, aberta ? 'feito-aberta' : '')} data-linha={linha.chave} role="button" tabIndex={0} aria-expanded={aberta}
      onClick={alternar} onKeyDown={aoTeclar} onMouseEnter={() => controle.aoApontar(linha.chave)} onMouseLeave={() => controle.aoApontar(null)}
      onFocus={() => controle.aoApontar(linha.chave)} onBlur={() => controle.aoApontar(null)}>
      <span className="feito-hora">{horaDaLinha(linha)}</span>
      <span className="feito-marca" aria-hidden="true">{SIMBOLO[linha.tipo]}</span>
      <p><Texto texto={linha.texto} />{aberta && assinatura && <span className="feito-assina">{assinatura}</span>}</p>
    </div>
  );
}

/** A última coisa feita: sempre aberta, em brasa. Quando o texto é a manchete, não se repete aqui. */
function LinhaDeOndeParamos({ linha, manchete, controle }: { linha: LinhaDoFeito; manchete: string | null; controle: ControleDoFeito }) {
  const assinatura = assinaturaDaLinha(linha);
  return (
    <div className={classesDaLinha(linha, controle, 'feito-agora')} data-linha={linha.chave} tabIndex={-1}
      onMouseEnter={() => controle.aoApontar(linha.chave)} onMouseLeave={() => controle.aoApontar(null)}
      onFocus={() => controle.aoApontar(linha.chave)} onBlur={() => controle.aoApontar(null)}>
      <span className="feito-hora">{horaDaLinha(linha)}</span>
      <span className="feito-marca" aria-hidden="true">◉</span>
      <p>
        <span className="feito-selo">Onde paramos</span>
        {repeteAManchete(linha.texto, manchete) ? <span className="feito-repetida">A frase do alto da tela.</span> : <Texto texto={linha.texto} />}
        {assinatura && <span className="feito-assina">{assinatura}</span>}
      </p>
    </div>
  );
}
