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
