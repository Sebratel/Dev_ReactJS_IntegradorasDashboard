import { useMatrixDetalhado, useMatrixFaixas, useMatrixFiltros, useMatrixSerie } from '../api';
import { CORES, ComboChart } from '../components/charts';
import { Filtro, FiltroPeriodo, usePeriodoPadrao, useFiltros } from '../components/SlicerBar';
import { Tabela } from '../components/tables';
import { Erro, Legenda, Loading, Segmentado, Vazio, Visual } from '../components/ui';
import { BotaoInsights } from '../components/InsightsIA';
import { dataBr, horaBr, hmsSeg, int, pct } from '../format';

/**
 * VISÃO GERAL RELATÓRIOS - MATRIX (página `7e775486029635d610a4` do relatório).
 *
 * Divergências propositais em relação à origem, todas por causa das agregações de lá:
 *  - ATENDIMENTOS na origem é `Sum(protocolo)` — soma o número do protocolo, da ordem
 *    de 9e15. Aqui é contagem. (A própria tabela de faixas do relatório se contradiz:
 *    a coluna soma protocolos e o percentual conta linhas.)
 *  - TMA/TME são medianas. `data_finalizacao` marca quando alguém fecha a conversa,
 *    não quando o atendimento acaba: 7% passam de 24h e levam a média para 6h34,
 *    contra 26 min de mediana.
 */
export function Matrix() {
  const padrao = usePeriodoPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({
    de: padrao.de,
    ate: padrao.ate,
    granularidade: 'dia',
  });

  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = {
    ...periodo,
    granularidade: valores.granularidade,
    ativoReceptivo: lista('ativoReceptivo'),
    status: lista('status'),
    servico: lista('servico'),
  };

  const opcoes = useMatrixFiltros(periodo);
  const serie = useMatrixSerie(filtros);
  const detalhado = useMatrixDetalhado(filtros);
  const faixas = useMatrixFaixas(filtros);

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo de={valores.de} ate={valores.ate} onChange={(de, ate) => { definir('de', de); definir('ate', ate); }} />
        <Filtro nome="Ativo/Receptivo" opcoes={opcoes.data?.ativoReceptivo || []} marcados={lista('ativoReceptivo')} onChange={(v) => definir('ativoReceptivo', v)} />
        <Filtro nome="Status" opcoes={opcoes.data?.status || []} marcados={lista('status')} onChange={(v) => definir('status', v)} />
        <Filtro nome="Serviço" opcoes={opcoes.data?.servico || []} marcados={lista('servico')} onChange={(v) => definir('servico', v)} />
        {temFiltro && <button type="button" className="limpar" onClick={limpar}>Limpar filtros</button>}
      </div>

      <Visual
        className="v-grafico"
        title="Indicadores Matrix"
        sub="Relatório detalhado com os principais indicadores do MatrixGO · TMA e TME em mediana"
        actions={
          <>
            <Segmentado
              valor={valores.granularidade}
              opcoes={[{ id: 'dia', label: 'dia' }, { id: 'mes', label: 'mês' }]}
              onChange={(g) => definir('granularidade', g)}
              titulo="Granularidade do eixo"
            />
            <BotaoInsights visual="geral-matrix:serie" titulo="Indicadores Matrix" filtros={filtros} />
          </>
        }
      >
        {serie.isLoading ? <Loading />
          : serie.isError ? <Erro erro={serie.error} />
          : !serie.data?.length ? <Vazio />
          : (
            <>
              <Legenda
                itens={[
                  { label: 'Atendimentos', cor: CORES.gold },
                  { label: 'Transferidas', cor: CORES.primary },
                  { label: 'TMA mediano', cor: CORES.ink, linha: true },
                  { label: 'TME mediano', cor: CORES.blue, linha: true },
                ]}
              />
              <ComboChart
                data={serie.data}
                barras={[
                  { key: 'atendimentos', nome: 'Atendimentos', cor: CORES.gold },
                  { key: 'transferidas', nome: 'Transferidas', cor: CORES.primary },
                ]}
                linhas={[
                  { key: 'tmaSeg', nome: 'TMA mediano', cor: CORES.ink, fmt: hmsSeg },
                  { key: 'tmeSeg', nome: 'TME mediano', cor: CORES.blue, fmt: hmsSeg },
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
          sub={`Amostra dos ${int(detalhado.data?.length || 0)} atendimentos mais recentes do recorte`}
          flush
        >
          {detalhado.isLoading ? <Loading />
            : detalhado.isError ? <Erro erro={detalhado.error} />
            : !detalhado.data?.length ? <Vazio />
            : (
              <Tabela
                dados={detalhado.data}
                colunas={[
                  { key: 'atendente', titulo: 'Atendente', align: 'left', largura: 190 },
                  { key: 'data_atendimento', titulo: 'Atendimento', align: 'left', fmt: (v) => `${dataBr(v)} ${horaBr(v)}` },
                  { key: 'servico', titulo: 'Serviço', align: 'left' },
                  { key: 'canal', titulo: 'Canal', align: 'left' },
                  { key: 'ativo_receptivo', titulo: 'Ativo/Rec.', align: 'left' },
                  {
                    key: 'status',
                    titulo: 'Status',
                    align: 'left',
                    // as cores de estado da paleta: transferido é atenção, finalizado é positivo
                    corFundo: (d) => (d.status === 'Transferido' ? CORES.fundoAtencao : d.status === 'Finalizado' ? CORES.fundoPositivo : null),
                  },
                  { key: 'protocolo', titulo: 'Protocolo', align: 'left' },
                  { key: 'tme_seg', titulo: 'TME', fmt: hmsSeg },
                  { key: 'tma_seg', titulo: 'TMA', fmt: hmsSeg },
                ]}
              />
            )}
        </Visual>

        <Visual
          className="v-tabela"
          title="Distribuição por Faixa de Tempo"
          sub="Espera até a primeira mensagem do agente"
          actions={<BotaoInsights visual="geral-matrix:faixas" titulo="Distribuição por Faixa de Tempo (Matrix)" filtros={filtros} />}
          flush
        >
          {faixas.isLoading ? <Loading />
            : faixas.isError ? <Erro erro={faixas.error} />
            : !faixas.data?.length ? <Vazio />
            : (
              <Tabela
                dados={faixas.data}
                colunas={[
                  { key: 'faixa', titulo: 'Faixa de tempo', align: 'left', fmt: (v) => (/^\d\d\.\s/.test(v) ? v.slice(4) : v) },
                  { key: 'atendimentos', titulo: 'Atendimentos', fmt: int, databar: { cor: CORES.gold600 } },
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
