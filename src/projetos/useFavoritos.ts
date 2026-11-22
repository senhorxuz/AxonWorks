import { useCallback, useEffect, useState } from 'react';
import { CHAVE_DOS_FAVORITOS, alternarFavorito, lerFavoritos } from './ordem';

const EVENTO = 'axon:favoritos';

const armazem = () => (typeof localStorage === 'undefined' ? undefined : localStorage);

/** Os favoritos deste computador. Quem os muda (a lista) e quem os mostra (a barra lateral) enxergam o mesmo. */
export function useFavoritos() {
  const [favoritos, setFavoritos] = useState(() => lerFavoritos(armazem()));
  useEffect(() => {
    const reler = () => setFavoritos(lerFavoritos(armazem()));
    window.addEventListener(EVENTO, reler);
    return () => window.removeEventListener(EVENTO, reler);
  }, []);
  const alternar = useCallback((id: string) => {
    const proximos = alternarFavorito(lerFavoritos(armazem()), id);
    try { localStorage.setItem(CHAVE_DOS_FAVORITOS, JSON.stringify(proximos)); } catch { /* A preferência vale só nesta visita. */ }
    setFavoritos(proximos);
    window.dispatchEvent(new Event(EVENTO));
  }, []);
  return { favoritos, alternar };
}
