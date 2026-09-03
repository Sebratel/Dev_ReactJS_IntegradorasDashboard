import { useNativeDetalhado, useNativeFaixas, useNativeFiltros, useNativeSerie } from '../api';
import { CORES, ComboChart } from '../components/charts';
import { Filtro, FiltroPeriodo, periodoPadrao, useFiltros } from '../components/SlicerBar';
import { Tabela } from '../components/tables';
import { Erro, Legenda, Loading, Segmentado, Vazio, Visual } from '../components/ui';
import { dataBr, horaBr, hmsSeg, int, pct } from '../format';

/**
 * VISÃO GERAL RELATÓRIOS - NATIVE (página `cf6d063fb88bc5b80adc` do relatório).
 *
 * Divergências propositais em relação à origem:
 *  - a série "Média de TME" lá é um SUM (rótulo diz média), e a coluna TME_minutes
 *    do modelo trunca para minuto inteiro — com 63% das esperas abaixo de 10s ela
 *    zeraria. Aqui TMA e TME são médias em segundos, como as medidas
 *    TMA_Native_Segundos/TME_Native_Segundos do próprio modelo, exibidas em hh:mm:ss;
 *  - a formatação condicional de linha da tabela detalhada aponta para a tabela
 *    `payments_contracts`, que não existe neste modelo (herdada de outro relatório):
 *    é configuração morta e não foi replicada;
 *  - "atendidas" na origem é a contagem de TODAS as chamadas, com as perdidas
 *    dentro — as duas colunas do gráfico não somavam o total, uma continha a outra.
 *    Aqui são as não-perdidas, mesma definição de `#native_completed_services`.
 */
export function Native() {
  const padrao = periodoPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({
    de: padrao.de,
    ate: padrao.ate,
    granularidade: 'dia',
  });

  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = {
    ...periodo,
    granularidade: valores.granularidade,
    sentido: lista('sentido'),
    fila: lista('fila'),
    desconexao: lista('desconexao'),
    agente: lista('agente'),
  };

  const opcoes = useNativeFiltros(periodo);
  const serie = useNativeSerie(filtros);
  const detalhado = useNativeDetalhado(filtros);
  const faixas = useNativeFaixas(filtros);

  const seriesLegenda = [
    { label: 'Atendidas', cor: CORES.gold },
    { label: 'Perdidas', cor: '#b3261e' },
    { label: 'TMA médio', cor: CORES.ink, linha: true },
    { label: 'TME médio', cor: CORES.blue, linha: true },
  ];

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo de={valores.de} ate={valores.ate} onChange={(de, ate) => { definir('de', de); definir('ate', ate); }} />
        <Filtro nome="Sentido" opcoes={opcoes.data?.sentido || []} marcados={lista('sentido')} onChange={(v) => definir('sentido', v)} />
        <Filtro nome="Fila" opcoes={opcoes.data?.fila || []} marcados={lista('fila')} onChange={(v) => definir('fila', v)} />
        <Filtro nome="Desconexão" opcoes={opcoes.data?.desconexao || []} marcados={lista('desconexao')} onChange={(v) => definir('desconexao', v)} />
        <Filtro nome="Agente" opcoes={opcoes.data?.agente || []} marcados={lista('agente')} onChange={(v) => definir('agente', v)} />
        {temFiltro && (
          <button type="button" className="limpar" onClick={limpar}>Limpar filtros</button>
        )}
      </div>

      <Visual
        className="v-grafico"
        title="Indicadores Native"
        sub="Relatório detalhado com os principais indicadores do Native Infinity"
        actions={
          <Segmentado
            valor={valores.granularidade}
            opcoes={[{ id: 'dia', label: 'dia' }, { id: 'mes', label: 'mês' }]}
            onChange={(g) => definir('granularidade', g)}
            titulo="Granularidade do eixo"
          />
        }
      >
        {serie.isLoading ? <Loading />
          : serie.isError ? <Erro erro={serie.error} />
          : !serie.data?.length ? <Vazio />
          : (
            <>
              <Legenda itens={seriesLegenda} />
              <ComboChart
                data={serie.data}
                barras={[
                  { key: 'atendidas', nome: 'Atendidas', cor: CORES.gold },
                  { key: 'perdidas', nome: 'Perdidas', cor: '#b3261e' },
                ]}
                linhas={[
                  { key: 'tmaSeg', nome: 'TMA médio', cor: CORES.ink, fmt: hmsSeg },
                  { key: 'tmeSeg', nome: 'TME médio', cor: CORES.blue, fmt: hmsSeg },
                ]}
                escalaSecundaria
              />
            </>
          )}
      </Visual>

      <div className="grid linha-grafico-tabelas">
        <Visual
          className="v-tabela"
          title="Relatório detalhado"
          sub={`Amostra das ${int(detalhado.data?.length || 0)} chamadas mais recentes do recorte`}
          flush
        >
          {detalhado.isLoading ? <Loading />
            : detalhado.isError ? <Erro erro={detalhado.error} />
            : !detalhado.data?.length ? <Vazio />
            : (
              <Tabela
                dados={detalhado.data}
                colunas={[
                  { key: 'agente', titulo: 'Agente', align: 'left', largura: 190 },
                  { key: 'data_hora', titulo: 'Data', align: 'left', fmt: (v) => `${dataBr(v)} ${horaBr(v)}` },
                  { key: 'fila', titulo: 'Fila', align: 'left' },
                  { key: 'sentido', titulo: 'Sentido', align: 'left' },
                  { key: 'desconexao', titulo: 'Desconexão', align: 'left', fmt: (v) => v || '—' },
                  { key: 'nome_cliente', titulo: 'Cliente', align: 'left' },
                  { key: 'protocolo', titulo: 'Protocolo', align: 'left' },
                  { key: 'espera', titulo: 'TME', fmt: (v) => v || '—' },
                  { key: 'atendimento', titulo: 'TMA', fmt: (v) => v || '—' },
                ]}
              />
            )}
        </Visual>

        <Visual
          className="v-tabela"
          title="Distribuição por Faixa de Tempo"
          sub="Espera até o atendimento, sobre o total do recorte"
          flush
        >
          {faixas.isLoading ? <Loading />
            : faixas.isError ? <Erro erro={faixas.error} />
            : !faixas.data?.length ? <Vazio />
            : (
              <Tabela
                dados={faixas.data}
                colunas={[
                  // o prefixo "00. " existe só para ordenar; some na leitura, mas a
                  // linha de total não tem prefixo e não pode ser fatiada junto
                  { key: 'faixa', titulo: 'Faixa de tempo', align: 'left', fmt: (v) => (/^\d\d\.\s/.test(v) ? v.slice(4) : v) },
                  { key: 'atendimentos', titulo: 'Chamadas', fmt: int, databar: { cor: CORES.gold600 } },
                  { key: 'percentual', titulo: '%', fmt: (v) => pct(v, 1) },
                ]}
                totais={{
                  faixa: 'Total',
                  atendimentos: faixas.data.reduce((s, r) => s + r.atendimentos, 0),
                  percentual: 1,
                }}
              />
            )}
        </Visual>
      </div>
    </div>
  );
}
