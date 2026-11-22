import { useEffect, useState, type RefObject } from 'react';
import { escalaDoElemento, paraPixelsCss } from '../escala-da-tela';
import type { CoisaFeita } from './coisas';
import { tamanhoDaLetra } from './tecer';

/** As medidas da grade do fio, em pixels de estilo: a letra escolhida, o tamanho de uma casa e quantas colunas cabem. */
export interface MedidaDoFio {
  tamanho: number;
  casa: number;
  linha: number;
  colunas: number;
}

const CASAS_DA_AMOSTRA = 50;

/** Mede uma letra de verdade na fonte da grade: a largura de uma casa e a altura de uma linha. */
function medirLetra(grade: HTMLElement, tamanho: number, escala: number): { casa: number; linha: number } {
  const amostra = document.createElement('span');
  amostra.style.cssText = `position:absolute;visibility:hidden;white-space:pre;line-height:normal;font-size:${tamanho}px`;
  amostra.textContent = '─'.repeat(CASAS_DA_AMOSTRA);
  grade.append(amostra);
  const caixa = amostra.getBoundingClientRect();
  amostra.remove();
  return { casa: paraPixelsCss(caixa.width, escala) / CASAS_DA_AMOSTRA, linha: paraPixelsCss(caixa.height, escala) };
}

function medir(grade: HTMLElement, coisas: CoisaFeita[]): MedidaDoFio | null {
  // O retângulo vem em pixels da tela; a ampliação dos monitores grandes multiplicaria tudo de novo.
  const escala = escalaDoElemento(grade);
  const largura = paraPixelsCss(grade.getBoundingClientRect().width, escala);
  if (largura <= 0) return null;
  const letras = new Map<number, { casa: number; linha: number }>();
  const letra = (tamanho: number) => {
    if (!letras.has(tamanho)) letras.set(tamanho, medirLetra(grade, tamanho, escala));
    return letras.get(tamanho)!;
  };
  const tamanho = tamanhoDaLetra(coisas, largura, t => letra(t).casa);
  const { casa, linha } = letra(tamanho);
  return { tamanho, casa, linha, colunas: Math.floor(largura / casa) };
}

/** A letra do fio é a maior em que ele cabe inteiro na largura que a tela dá; a medida se refaz quando a largura muda. */
export function useMedidaDoFio(grade: RefObject<HTMLElement | null>, coisas: CoisaFeita[]): MedidaDoFio | null {
  const [medida, setMedida] = useState<MedidaDoFio | null>(null);
  useEffect(() => {
    const elemento = grade.current;
    if (!elemento) return;
    const remedir = () => {
      // Mede fora do atualizador: ele não pode mexer no DOM (o React pode chamá-lo mais de uma vez).
      const nova = medir(elemento, coisas);
      setMedida(anterior => {
        const igual = anterior && nova && anterior.tamanho === nova.tamanho && anterior.colunas === nova.colunas && anterior.casa === nova.casa;
        return igual ? anterior : nova;
      });
    };
    remedir();
    const vigia = new ResizeObserver(remedir);
    vigia.observe(elemento);
    return () => vigia.disconnect();
  }, [grade, coisas]);
  return medida;
}
