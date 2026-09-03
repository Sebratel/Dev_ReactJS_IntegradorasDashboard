import { useQuery } from '@tanstack/react-query';

async function apiGet(path, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const url = `/api/geral${path}${qs.toString() ? `?${qs}` : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    let detalhe = '';
    try { detalhe = (await resp.json()).error || ''; } catch { /* corpo não-JSON */ }
    const erro = new Error(detalhe || `Falha ao carregar dados (${resp.status})`);
    erro.status = resp.status;
    throw erro;
  }
  return resp.json();
}

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => apiGet('/health'), refetchInterval: 60000, retry: 1 });
}

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => apiGet('/meta'), refetchInterval: 120000 });
}

export function useNativeSerie(filtros) {
  return useQuery({ queryKey: ['native', 'serie', filtros], queryFn: () => apiGet('/native/serie', filtros) });
}

export function useNativeDetalhado(filtros) {
  return useQuery({ queryKey: ['native', 'detalhado', filtros], queryFn: () => apiGet('/native/detalhado', filtros) });
}

export function useNativeFaixas(filtros) {
  return useQuery({ queryKey: ['native', 'faixas', filtros], queryFn: () => apiGet('/native/faixas', filtros) });
}

/** As opções dos slicers dependem só do período, não das outras marcações. */
export function useNativeFiltros(periodo) {
  return useQuery({
    queryKey: ['native', 'filtros', periodo],
    queryFn: () => apiGet('/native/filtros', periodo),
    staleTime: 5 * 60000,
  });
}

export function useMatrixSerie(filtros) {
  return useQuery({ queryKey: ['matrix', 'serie', filtros], queryFn: () => apiGet('/matrix/serie', filtros) });
}

export function useMatrixDetalhado(filtros) {
  return useQuery({ queryKey: ['matrix', 'detalhado', filtros], queryFn: () => apiGet('/matrix/detalhado', filtros) });
}

export function useMatrixFaixas(filtros) {
  return useQuery({ queryKey: ['matrix', 'faixas', filtros], queryFn: () => apiGet('/matrix/faixas', filtros) });
}

export function useMatrixFiltros(periodo) {
  return useQuery({
    queryKey: ['matrix', 'filtros', periodo],
    queryFn: () => apiGet('/matrix/filtros', periodo),
    staleTime: 5 * 60000,
  });
}

/** `qual` = 'csat-matrix' ou 'csat-native' — as duas telas têm a mesma forma. */
export function useCsatSerie(qual, filtros) {
  return useQuery({ queryKey: [qual, 'serie', filtros], queryFn: () => apiGet(`/${qual}/serie`, filtros) });
}

export function useCsatDetalhado(qual, filtros) {
  return useQuery({ queryKey: [qual, 'detalhado', filtros], queryFn: () => apiGet(`/${qual}/detalhado`, filtros) });
}

export function useCsatFiltros(qual, periodo) {
  return useQuery({
    queryKey: [qual, 'filtros', periodo],
    queryFn: () => apiGet(`/${qual}/filtros`, periodo),
    staleTime: 5 * 60000,
  });
}

/** `qual` = 'matrix' | 'native' | 'elleven' — as três tabelas da PRODUTIVIDADE. */
export function useProdutividade(qual, filtros) {
  return useQuery({
    queryKey: ['produtividade', qual, filtros],
    queryFn: () => apiGet(`/produtividade/${qual}`, filtros),
  });
}

export function useProdutividadeFiltros(periodo) {
  return useQuery({
    queryKey: ['produtividade', 'filtros', periodo],
    queryFn: () => apiGet('/produtividade/filtros', periodo),
    staleTime: 5 * 60000,
  });
}

export function useSupAcompanhamento(filtros) {
  return useQuery({ queryKey: ['sup', 'acompanhamento', filtros], queryFn: () => apiGet('/sup/acompanhamento', filtros) });
}

export function useSupEntrantes(filtros) {
  return useQuery({ queryKey: ['sup', 'entrantes', filtros], queryFn: () => apiGet('/sup/entrantes', filtros) });
}

export function useSupMassivas(filtros) {
  return useQuery({ queryKey: ['sup', 'massivas', filtros], queryFn: () => apiGet('/sup/massivas', filtros) });
}

export function useSupFiltros(periodo) {
  return useQuery({
    queryKey: ['sup', 'filtros', periodo],
    queryFn: () => apiGet('/sup/filtros', periodo),
    staleTime: 5 * 60000,
  });
}

export function useQuartis(filtros) {
  return useQuery({ queryKey: ['quartis', filtros], queryFn: () => apiGet('/quartis', filtros) });
}

/** Janela em que a base de avaliações tem dado — a do Native parou em dez/2025. */
export function useCsatCobertura(qual) {
  return useQuery({
    queryKey: [qual, 'cobertura'],
    queryFn: () => apiGet(`/${qual}/cobertura`),
    staleTime: 10 * 60000,
  });
}
