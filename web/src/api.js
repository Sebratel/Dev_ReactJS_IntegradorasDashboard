import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { encerrarSessao } from './auth/session.jsx';
import { tokenAtual } from './auth/firebase';

/** Monta a querystring ignorando o que está vazio. */
export function buildQuery(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return qs.toString();
}

/**
 * ÚNICO caminho de saída para a API. Todo `fetch` do dashboard passa por aqui.
 *
 * Isso não é zelo estético: um `fetch` cru esquecido num botão sai sem cabeçalho
 * de autorização, toma 401 em silêncio, a ação nunca acontece — e ainda parece
 * ter funcionado, porque o cache do front recarrega de todo jeito.
 *
 * O 401 é tratado com UMA renovação forçada antes de desistir. Só se a segunda
 * tentativa também falhar a sessão é encerrada: derrubar na primeira falha
 * transformaria um token vencido em cache (coisa normal) em logout.
 */
export async function apiFetch(url, opcoes = {}) {
  const comToken = async (forcar) => {
    const token = await tokenAtual(forcar).catch(() => null);
    return fetch(url, {
      ...opcoes,
      headers: {
        ...(opcoes.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };

  let resp = await comToken(false);
  if (resp.status === 401) {
    resp = await comToken(true);
    if (resp.status === 401) {
      encerrarSessao('expirada', `${url} devolveu 401 mesmo após renovar o token`);
    }
  }
  return resp;
}

async function apiGet(path, params) {
  const qs = buildQuery(params);
  const url = `/api/geral${path}${qs ? `?${qs}` : ''}`;
  const resp = await apiFetch(url);
  if (!resp.ok) {
    let detalhe = '';
    try { detalhe = (await resp.json()).error || ''; } catch { /* corpo não-JSON */ }
    const erro = new Error(detalhe || `Falha ao carregar dados (${resp.status})`);
    erro.status = resp.status;
    throw erro;
  }
  return resp.json();
}

/** Chamadas administrativas — mesmo cliente, mesma renovação de token. */
export async function apiAdmin(caminho, opcoes = {}) {
  const resp = await apiFetch(`/api${caminho}`, {
    ...opcoes,
    headers: {
      ...(opcoes.body ? { 'content-type': 'application/json' } : {}),
      ...(opcoes.headers || {}),
    },
  });
  const corpo = await resp.json().catch(() => null);
  if (!resp.ok) {
    const erro = new Error(corpo?.error || `Erro ${resp.status}`);
    erro.status = resp.status;
    throw erro;
  }
  return corpo;
}

/**
 * Botão de atualizar da barra do topo: descarta o cache do servidor e refaz as
 * consultas da tela. Sem limpar o lado do servidor, o botão não faria nada
 * visível durante o TTL — e o de Quartis é de 15 minutos.
 */
export function useAtualizarAgora() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiAdmin('/cache/limpar', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  });
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

export function useAnaliticoAtendimento(filtros) {
  return useQuery({ queryKey: ['analiticos', 'atendimento', filtros], queryFn: () => apiGet('/analiticos/atendimento', filtros) });
}

export function useAnaliticoHsm(filtros) {
  return useQuery({ queryKey: ['analiticos', 'hsm', filtros], queryFn: () => apiGet('/analiticos/hsm', filtros) });
}

export function useAnaliticoCx(filtros) {
  return useQuery({ queryKey: ['analiticos', 'cx', filtros], queryFn: () => apiGet('/analiticos/cx', filtros) });
}

export function useAnaliticoCxDetalhe(filtros) {
  return useQuery({ queryKey: ['analiticos', 'cx', 'detalhe', filtros], queryFn: () => apiGet('/analiticos/cx/detalhamento', filtros) });
}

/** Disparo de CX cruzado com o atendimento gerado e a resposta da pesquisa. */
export function useAnaliticoCxCruzado(filtros) {
  return useQuery({ queryKey: ['analiticos', 'cx', 'cruzado', filtros], queryFn: () => apiGet('/analiticos/cx/cruzado', filtros) });
}

/**
 * Disparos do n8n com a reconciliação contra o relatório da Meta. Vive na tela
 * de HSM: é a outra metade do funil de envio.
 */
export function useAnaliticoDisparos(filtros) {
  return useQuery({ queryKey: ['analiticos', 'disparos', filtros], queryFn: () => apiGet('/analiticos/disparos', filtros) });
}

/**
 * Mensagens de um motivo de não entrega. `ativo` mantém a consulta desligada
 * até alguém abrir um motivo — são centenas de linhas que ninguém pediu ainda.
 */
export function useAnaliticoHsmFalhas(filtros, ativo) {
  return useQuery({
    queryKey: ['analiticos', 'hsm', 'falhas', filtros],
    queryFn: () => apiGet('/analiticos/hsm/falhas', filtros),
    enabled: !!ativo,
  });
}

export function useAnaliticosFiltros(periodo) {
  return useQuery({
    queryKey: ['analiticos', 'filtros', periodo],
    queryFn: () => apiGet('/analiticos/filtros', periodo),
    staleTime: 5 * 60000,
  });
}

export function useSupResumo(qual, filtros) {
  return useQuery({ queryKey: ['sup', qual, 'resumo', filtros], queryFn: () => apiGet(`/sup/${qual}/resumo`, filtros) });
}

export function useSupDetalhamento(qual, filtros) {
  return useQuery({ queryKey: ['sup', qual, 'detalhamento', filtros], queryFn: () => apiGet(`/sup/${qual}/detalhamento`, filtros) });
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
