import { buscarTodas, useTotalDetalhado } from '../api';
import { int } from '../format';
import { Tabela } from './tables';
import { Erro, Loading, Vazio } from './ui';

/**
 * Relatório detalhado das telas do GERAL (D-10, opção B, decisão de 12/11/2026):
 * a tela mostra as 500 linhas mais recentes, diz quantas existem no recorte, e o CSV
 * busca TODAS no servidor. Antes o CSV levava só as 500 da tela, sem aviso — quem
 * conferia contra o Power BI achava que faltava dado.
 *
 * `caminho` é o da API ('/matrix/detalhado', '/csat-native/detalhado'...); o total
 * vem de `${caminho}/total`, com os mesmos filtros.
 */
export function useLegendaDetalhado(caminho, filtros, mostradas, unidade) {
  const total = useTotalDetalhado(caminho, filtros);
  const n = total.data?.total;
  if (n === undefined || n === null) return `${int(mostradas)} ${unidade} mais recentes do recorte`;
  if (n <= mostradas) return `${int(n)} ${unidade} no recorte`;
  return `Mostrando as ${int(mostradas)} mais recentes de ${int(n)} ${unidade} · o CSV traz todas`;
}

export function TabelaDetalhada({ caminho, filtros, consulta, colunas, vazio }) {
  if (consulta.isLoading) return <Loading />;
  if (consulta.isError) return <Erro erro={consulta.error} />;
  if (!consulta.data?.length) return <Vazio texto={vazio} />;
  return (
    <Tabela
      dados={consulta.data}
      colunas={colunas}
      exportarTudo={() => buscarTodas(caminho, filtros)}
    />
  );
}
