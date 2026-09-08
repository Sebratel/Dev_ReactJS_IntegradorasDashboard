import { useMemo, useRef } from 'react';
import { useProdutividade, useProdutividadeFiltros } from '../api';
import { CORES, escalaGradiente } from '../components/charts';
import { Filtro, FiltroPeriodo, usePeriodoPadrao, useFiltros } from '../components/SlicerBar';
import { useAlturaNoCromo } from '../components/cromo';
import { Tabela } from '../components/tables';
import { Erro, Loading, Vazio, Visual } from '../components/ui';
import { hmsSeg, int, pct } from '../format';

/**
 * PRODUTIVIDADE (página `220bb0a3380b7b391d80`): na origem são TRÊS tabelas
 * empilhadas num canvas mais alto que a tela. Aqui elas viram sub-navegação — uma
 * por vez, em altura cheia — porque duas faixas é o teto de uma tela, e uma tabela
 * de ~150 agentes espremida em um terço de tela não se lê. Os filtros valem para as
 * três, então ficam acima da sub-navegação, como no relatório.
 */

const VISOES = [
  { id: 'matrix', label: 'MatrixGO', titulo: 'Relatório de atendimentos - MatrixGO' },
  { id: 'native', label: 'Native Infinity', titulo: 'Relatório de atendimentos - Native Infinity' },
  { id: 'elleven', label: 'Elleven', titulo: 'Abertura de protocolos - Elleven' },
];

/**
 * Heatmap de MAGNITUDE por coluna: um só tom, claro -> escuro, do menor ao maior
 * valor da coluna. O texto sai da luminância do fundo, nunca fixo.
 */
function comHeatmap(dados, key, de = CORES.goldLight, ate = CORES.gold600) {
  const valores = dados.map((d) => d[key]).filter((v) => v !== null && v !== undefined);
  const min = Math.min(...valores, 0);
  const max = Math.max(...valores, 1);
  return (linha) => {
    const v = linha[key];
    if (v === null || v === undefined) return null;
    return escalaGradiente(v, min, max, de, ate);
  };
}

export function Produtividade() {
  const padrao = usePeriodoPadrao();
  const { valores, definir, definirVarios, limpar, lista, temFiltro } = useFiltros({
    de: padrao.de, ate: padrao.ate, visao: 'matrix',
  });

  const visao = VISOES.find((v) => v.id === valores.visao) ? valores.visao : 'matrix';
  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = {
    ...periodo,
    servico: lista('servico'),
    ativoReceptivo: lista('ativoReceptivo'),
    fila: lista('fila'),
    sentido: lista('sentido'),
  };

  const opcoes = useProdutividadeFiltros(periodo);
  const consulta = useProdutividade(visao, filtros);
  const dados = consulta.data || [];

  const colunas = useMemo(() => {
    if (visao === 'elleven') {
      return [
        { key: 'agente', titulo: 'Agente', align: 'left', largura: 260 },
        { key: 'equipe', titulo: 'Equipe', align: 'left', fmt: (v) => v || '—' },
        { key: 'protocolos', titulo: 'Protocolos', fmt: int, corFundo: comHeatmap(dados, 'protocolos') },
        { key: 'tipos', titulo: 'Tipos de protocolo', fmt: int },
      ];
    }
    const comuns = [
      { key: 'agente', titulo: 'Agente', align: 'left', largura: 260 },
      { key: 'atendimentos', titulo: 'Atendimentos', fmt: int, corFundo: comHeatmap(dados, 'atendimentos') },
      { key: 'tmaSeg', titulo: 'TMA mediano', fmt: hmsSeg, corFundo: comHeatmap(dados, 'tmaSeg') },
      { key: 'tmeSeg', titulo: 'TME mediano', fmt: hmsSeg, corFundo: comHeatmap(dados, 'tmeSeg') },
    ];
    const tempos = [
      { key: 'logadoDiaSeg', titulo: 'Logado / dia', fmt: hmsSeg, corFundo: comHeatmap(dados, 'logadoDiaSeg') },
      { key: 'pausaDiaSeg', titulo: 'Pausa / dia', fmt: hmsSeg, corFundo: comHeatmap(dados, 'pausaDiaSeg') },
    ];
    if (visao === 'matrix') {
      return [
        ...comuns,
        {
          key: 'csat',
          titulo: 'CSAT',
          fmt: (v) => (v === null ? '—' : pct(v, 1)),
          // escala própria (branco -> verde), como no relatório de origem
          corFundo: comHeatmap(dados, 'csat', CORES.branco, CORES.verdeEscuro),
        },
        ...tempos,
      ];
    }
    return [...comuns, ...tempos];
  }, [visao, dados]);

  const filtrosDaVisao = visao === 'matrix'
    ? [{ chave: 'servico', nome: 'Serviço' }, { chave: 'ativoReceptivo', nome: 'Ativo/Receptivo' }]
    : visao === 'native'
      ? [{ chave: 'fila', nome: 'Fila' }, { chave: 'sentido', nome: 'Sentido' }]
      : [];

  const atual = VISOES.find((v) => v.id === visao);
  const refSubnav = useRef(null);
  useAlturaNoCromo(refSubnav, '--h-subnav');

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo de={valores.de} ate={valores.ate} onChange={(de, ate) => { definirVarios({ de, ate }); }} />
        {filtrosDaVisao.map((f) => (
          <Filtro
            key={f.chave}
            nome={f.nome}
            opcoes={opcoes.data?.[f.chave] || []}
            marcados={lista(f.chave)}
            onChange={(v) => definir(f.chave, v)}
          />
        ))}
        {temFiltro && <button type="button" className="limpar" onClick={limpar}>Limpar filtros</button>}
      </div>

      <div className="subnav" ref={refSubnav}>
        {VISOES.map((v) => (
          <button key={v.id} type="button" className={visao === v.id ? 'on' : ''} onClick={() => definir('visao', v.id)}>
            {v.label}
          </button>
        ))}
        <span className="dica">
          {dados.length ? `${int(dados.length)} agentes no período` : ''}
        </span>
      </div>

      <Visual
        className="v-matriz"
        title={atual.titulo}
        sub={visao === 'elleven'
          ? 'Protocolos abertos no Elleven por quem os criou'
          : 'TMA e TME em mediana; tempo logado e de pausa são médias por dia trabalhado'}
        flush
      >
        {consulta.isLoading ? <Loading />
          : consulta.isError ? <Erro erro={consulta.error} />
          : !dados.length ? <Vazio />
          : (
            <Tabela
              dados={dados}
              colunas={colunas}
              ordemInicial={{ key: visao === 'elleven' ? 'protocolos' : 'atendimentos', dir: 'desc' }}
            />
          )}
      </Visual>
    </div>
  );
}
