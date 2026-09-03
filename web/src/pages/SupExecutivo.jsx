import { useRef } from 'react';
import { useSupAcompanhamento, useSupEntrantes, useSupFiltros, useSupMassivas } from '../api';
import { CORES, ComboChart, corDoTexto, escalaGradiente } from '../components/charts';
import { Filtro, FiltroPeriodo, periodoPadrao, useFiltros } from '../components/SlicerBar';
import { useAlturaNoCromo } from '../components/cromo';
import { Tabela } from '../components/tables';
import { Erro, Legenda, Loading, Vazio, Visual } from '../components/ui';
import { dataBr, horaBr, hmsSeg, int, pct } from '../format';

/**
 * REPORT EXECUTIVO (página `4c790b1c209c9ca26ba1` do relatório SUP).
 *
 * O eixo é o CHECKPOINT: seis horas fixas do dia, e cada número é acumulado até
 * aquela hora. As massivas são a exceção — o modelo as conta por FAIXA (entre o
 * checkpoint anterior e o atual), e essa assimetria foi preservada.
 *
 * Na origem são cinco visuais empilhados num canvas bem mais alto que a tela. Aqui
 * viram duas visões de duas faixas cada, porque duas faixas é o teto de uma tela.
 * As colunas de nível de serviço entram na própria tabela de acompanhamento: são
 * por checkpoint como as demais, e repetir as seis linhas num visual só para elas
 * gastaria uma faixa inteira.
 */

const META_NS = 0.9;

/** Verde quando bate a meta de 90%, vermelho quando não bate. Polaridade, não escala. */
const corDoNS = (v) => {
  if (v === null || v === undefined) return null;
  return v >= META_NS ? CORES.fundoPositivo : CORES.fundoAtencao;
};

function TabelaAcompanhamento({ dados }) {
  const maxEntrantes = Math.max(...dados.map((d) => d.entrantes), 1);
  return (
    <Tabela
      dados={dados.map((d, i) => ({ ...d, __key: d.hora + i }))}
      colunas={[
        { key: 'hora', titulo: 'Checkpoint', align: 'left', bold: true },
        { key: 'agentesTotal', titulo: 'Agentes', fmt: int },
        { key: 'qtdMatrix', titulo: 'Qtd Matrix', fmt: int },
        { key: 'tmaMatrixSeg', titulo: 'TMA Matrix', fmt: hmsSeg },
        { key: 'tmeMatrixSeg', titulo: 'TME Matrix', fmt: hmsSeg },
        { key: 'qtdNative', titulo: 'Qtd Native', fmt: int },
        { key: 'tmaNativeSeg', titulo: 'TMA Native', fmt: hmsSeg },
        { key: 'tmeNativeSeg', titulo: 'TME Native', fmt: hmsSeg },
        {
          key: 'entrantes',
          titulo: 'Entrantes',
          fmt: int,
          bold: true,
          corFundo: (d) => escalaGradiente(d.entrantes, 0, maxEntrantes, CORES.goldLight, CORES.gold600),
        },
        { key: 'meta', titulo: 'Meta', fmt: (v) => (v === null ? '—' : int(v)) },
        {
          key: 'desvioMeta',
          titulo: '% vs meta',
          fmt: (v) => (v === null ? '—' : pct(v, 1)),
          corFundo: (d) => (d.desvioMeta === null ? null : d.desvioMeta >= 0 ? CORES.fundoPositivo : CORES.fundoAtencao),
        },
        { key: 'nsMatrix', titulo: 'NS Matrix', fmt: (v) => (v === null ? '—' : pct(v, 1)), corFundo: (d) => corDoNS(d.nsMatrix) },
        { key: 'nsNative', titulo: 'NS Native', fmt: (v) => (v === null ? '—' : pct(v, 1)), corFundo: (d) => corDoNS(d.nsNative) },
        { key: 'nsFinal', titulo: 'NS final', fmt: (v) => (v === null ? '—' : pct(v, 1)), bold: true, corFundo: (d) => corDoNS(d.nsFinal) },
        { key: 'massivasEventos', titulo: 'Massivas', fmt: int },
        { key: 'massivasClientes', titulo: 'Clientes afetados', fmt: int },
      ]}
    />
  );
}

/** Ontem: o dia fechado mais recente, que é como este report é lido de manhã. */
function diaPadrao() {
  const d = new Date(Date.now() - 864e5);
  return d.toISOString().slice(0, 10);
}

export function SupExecutivo() {
  // um DIA, não os 30 das outras telas: a meta do checkpoint é a média de um dia
  // (as 6 últimas datas do mesmo dia da semana), então comparar com um período de
  // vários dias somaria os entrantes de todos contra a régua de um só.
  const dia = diaPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({
    de: dia, ate: dia, visao: 'indicadores',
  });
  const periodoLongo = valores.de !== valores.ate;

  const visao = valores.visao === 'massivas' ? 'massivas' : 'indicadores';
  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = {
    ...periodo,
    servico: lista('servico'),
    ativoReceptivo: lista('ativoReceptivo'),
    fila: lista('fila'),
    sentido: lista('sentido'),
  };

  const refSubnav = useRef(null);
  useAlturaNoCromo(refSubnav, '--h-subnav');

  const opcoes = useSupFiltros(periodo);
  const acompanhamento = useSupAcompanhamento(filtros);
  const entrantes = useSupEntrantes(filtros);
  const massivas = useSupMassivas(filtros);

  const eventos = massivas.data || [];
  const resumoMassivas = Object.values(
    eventos.reduce((acc, e) => {
      const chave = e.status || '(sem status)';
      acc[chave] = acc[chave] || { status: chave, eventos: 0, clientes: 0 };
      acc[chave].eventos += 1;
      acc[chave].clientes += e.clientes;
      return acc;
    }, {}),
  ).sort((a, b) => b.eventos - a.eventos);

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo de={valores.de} ate={valores.ate} onChange={(de, ate) => { definir('de', de); definir('ate', ate); }} />
        <Filtro nome="Serviço Matrix" opcoes={opcoes.data?.servico || []} marcados={lista('servico')} onChange={(v) => definir('servico', v)} />
        <Filtro nome="Ativo/Receptivo" opcoes={opcoes.data?.ativoReceptivo || []} marcados={lista('ativoReceptivo')} onChange={(v) => definir('ativoReceptivo', v)} />
        <Filtro nome="Fila Native" opcoes={opcoes.data?.fila || []} marcados={lista('fila')} onChange={(v) => definir('fila', v)} />
        <Filtro nome="Sentido Native" opcoes={opcoes.data?.sentido || []} marcados={lista('sentido')} onChange={(v) => definir('sentido', v)} />
        {temFiltro && <button type="button" className="limpar" onClick={limpar}>Limpar filtros</button>}
      </div>

      <div className="subnav" ref={refSubnav}>
        <button type="button" className={visao === 'indicadores' ? 'on' : ''} onClick={() => definir('visao', 'indicadores')}>
          Indicadores
        </button>
        <button type="button" className={visao === 'massivas' ? 'on' : ''} onClick={() => definir('visao', 'massivas')}>
          Massivas
        </button>
        <span className="dica">
          {visao === 'indicadores'
            ? 'Números acumulados até cada checkpoint · meta de nível de serviço: 90%'
            : `${int(eventos.length)} eventos no período`}
        </span>
      </div>

      {visao === 'indicadores' ? (
        <>
          <Visual
            className="v-tabela"
            title="Acompanhamento de indicadores"
            sub={'Acumulado até cada checkpoint · NS Matrix conta resposta em até 45s, NS Native em até 25s de espera'
              + (periodoLongo
                ? ' · ATENÇÃO: a meta é a média de UM dia (as 6 últimas do mesmo dia da semana), então com período de vários dias a coluna "% vs meta" não compara'
                : ' · meta = média das 6 últimas datas do mesmo dia da semana')}
            flush
          >
            {acompanhamento.isLoading ? <Loading />
              : acompanhamento.isError ? <Erro erro={acompanhamento.error} />
              : !acompanhamento.data?.length ? <Vazio />
              : <TabelaAcompanhamento dados={acompanhamento.data} />}
          </Visual>

          <Visual
            className="v-grafico"
            title="Total entrantes (Native + Matrix)"
            sub="Atendimentos por dia em cada plataforma"
          >
            {entrantes.isLoading ? <Loading />
              : entrantes.isError ? <Erro erro={entrantes.error} />
              : !entrantes.data?.length ? <Vazio />
              : (
                <>
                  <Legenda
                    itens={[
                      { label: 'Matrix', cor: CORES.gold },
                      { label: 'Native', cor: CORES.primary },
                    ]}
                  />
                  <ComboChart
                    data={entrantes.data}
                    barras={[
                      { key: 'matrix', nome: 'Matrix', cor: CORES.gold },
                      { key: 'native', nome: 'Native', cor: CORES.primary },
                    ]}
                  />
                </>
              )}
          </Visual>
        </>
      ) : (
        <div className="grid linha-grafico-tabelas">
          <Visual className="v-tabela" title="Detalhamento massivas" sub="Eventos de indisponibilidade abertos no período" flush>
            {massivas.isLoading ? <Loading />
              : massivas.isError ? <Erro erro={massivas.error} />
              : !eventos.length ? <Vazio texto="Nenhum evento massivo no período" />
              : (
                <Tabela
                  dados={eventos.map((e, i) => ({ ...e, __key: `${e.protocolo}-${i}` }))}
                  colunas={[
                    { key: 'dataCriacao', titulo: 'Abertura', align: 'left', fmt: (v) => `${dataBr(v)} ${horaBr(v)}` },
                    { key: 'protocolo', titulo: 'Protocolo', align: 'left' },
                    { key: 'status', titulo: 'Status', align: 'left', fmt: (v) => v || '—' },
                    { key: 'faixa', titulo: 'Checkpoint', align: 'left', fmt: (v) => (v === '23:59:59' ? '24:00' : v.slice(0, 5)) },
                    { key: 'clientes', titulo: 'Clientes afetados', fmt: int, databar: { cor: CORES.gold600 } },
                  ]}
                  ordemInicial={{ key: 'dataCriacao', dir: 'desc' }}
                />
              )}
          </Visual>

          <Visual className="v-tabela" title="Resumo massivas" sub="Por status do evento" flush>
            {massivas.isLoading ? <Loading />
              : !resumoMassivas.length ? <Vazio />
              : (
                <Tabela
                  dados={resumoMassivas.map((r) => ({ ...r, __key: r.status }))}
                  colunas={[
                    { key: 'status', titulo: 'Status', align: 'left' },
                    { key: 'eventos', titulo: 'Eventos', fmt: int, databar: { cor: CORES.gold600 } },
                    { key: 'clientes', titulo: 'Clientes', fmt: int },
                  ]}
                  totais={{
                    status: 'Total',
                    eventos: resumoMassivas.reduce((s, r) => s + r.eventos, 0),
                    clientes: resumoMassivas.reduce((s, r) => s + r.clientes, 0),
                  }}
                />
              )}
          </Visual>
        </div>
      )}
    </div>
  );
}
