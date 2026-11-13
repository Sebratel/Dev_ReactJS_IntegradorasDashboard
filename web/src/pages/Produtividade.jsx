import { Fragment, useMemo, useRef, useState } from 'react';
import { useProdutividade, useProdutividadeFiltros } from '../api';
import { CORES, corDoTexto, escalaGradiente } from '../components/charts';
import { Filtro, FiltroPeriodo, useInicioGeral, usePeriodoPadrao, useFiltros } from '../components/SlicerBar';
import { useAlturaNoCromo } from '../components/cromo';
import { Tabela } from '../components/tables';
import { Erro, Loading, useExportavel, Vazio, Visual } from '../components/ui';
import { hmsSeg, int, pct } from '../format';

/**
 * PRODUTIVIDADE (página `220bb0a3380b7b391d80`): na origem são TRÊS tabelas
 * empilhadas num canvas mais alto que a tela. Aqui elas viram sub-navegação — uma
 * por vez, em altura cheia — porque duas faixas é o teto de uma tela, e uma tabela
 * de ~150 agentes espremida em um terço de tela não se lê. Os filtros valem para as
 * três, então ficam acima da sub-navegação, como no relatório.
 *
 * QA fase 1:
 *  - slicer AGENTE (D-08), pelo nome canônico do CRM;
 *  - quem não casa com o CRM vira UMA linha "Sem correspondência", sempre no fim e
 *    fora da escala de cores (D-15, como o Power BI);
 *  - Elleven: uma linha por agente que se expande nos tipos de protocolo, e a ISA
 *    (robô) numa linha própria, fora do ranking (DN-06, D-20).
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
  // a linha "Sem correspondência" e a ISA não entram na escala: somam muita gente
  // (ou um robô) e esmagariam as cores de todos os agentes
  const foraDaEscala = (d) => d.semCorrespondencia || d.robo;
  const valores = dados.filter((d) => !foraDaEscala(d)).map((d) => d[key]).filter((v) => v !== null && v !== undefined);
  const min = Math.min(...valores, 0);
  const max = Math.max(...valores, 1);
  return (linha) => {
    const v = linha[key];
    if (v === null || v === undefined || foraDaEscala(linha)) return null;
    return escalaGradiente(v, min, max, de, ate);
  };
}

const fixoNoFim = (d) => d.semCorrespondencia;

/**
 * Tabela do Elleven (DN-06, opção C): uma linha por agente; o clique abre os tipos de
 * protocolo com a quantidade de cada um. A ISA - Agente Virtual fica abaixo, numa
 * faixa "Fora do ranking", porque abre protocolo aos milhares e não é agente.
 *
 * O CSV sai no mesmo formato da expansão: a linha do agente (tipo "Todos") e uma
 * linha por tipo.
 */
function TabelaElleven({ dados }) {
  const [abertos, setAbertos] = useState(() => new Set());
  const [ordem, setOrdem] = useState({ key: 'protocolos', dir: 'desc' });

  const agentes = useMemo(() => {
    const lista = dados.filter((d) => !d.robo);
    const sinal = ordem.dir === 'asc' ? 1 : -1;
    return lista.sort((a, b) => {
      const va = a[ordem.key];
      const vb = b[ordem.key];
      if (typeof va === 'number' || typeof vb === 'number') return sinal * ((va || 0) - (vb || 0));
      return sinal * String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR');
    });
  }, [dados, ordem]);
  const robos = dados.filter((d) => d.robo);
  const heat = comHeatmap(dados, 'protocolos');

  useExportavel(null, () => {
    if (!dados.length) return null;
    const linhas = [];
    for (const a of [...agentes, ...robos]) {
      linhas.push({ agente: a.agente, equipe: a.equipe, tipo: 'Todos', protocolos: a.protocolos, ranking: a.robo ? 'Fora do ranking' : '' });
      for (const t of a.porTipo || []) {
        linhas.push({ agente: a.agente, equipe: a.equipe, tipo: t.tipo, protocolos: t.protocolos, ranking: a.robo ? 'Fora do ranking' : '' });
      }
    }
    return {
      colunas: [
        { key: 'agente', titulo: 'Agente' },
        { key: 'equipe', titulo: 'Equipe', fmt: (v) => v || '—' },
        { key: 'tipo', titulo: 'Tipo de protocolo' },
        { key: 'protocolos', titulo: 'Protocolos', fmt: int },
        { key: 'ranking', titulo: 'Observação' },
      ],
      linhas,
    };
  });

  const alternar = (chave) => setAbertos((atual) => {
    const novo = new Set(atual);
    if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
    return novo;
  });
  const ordenarPor = (key) => setOrdem((o) => (o.key === key
    ? { key, dir: o.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'agente' || key === 'equipe' ? 'asc' : 'desc' }));
  const seta = (key) => (ordem.key === key ? (ordem.dir === 'asc' ? ' ▲' : ' ▼') : '');

  const linhaAgente = (a) => {
    const chave = `${a.agente}|${a.equipe}`;
    const aberto = abertos.has(chave);
    const fundo = heat(a);
    return (
      <Fragment key={chave}>
        <tr onClick={() => alternar(chave)} style={{ cursor: 'pointer' }} title={aberto ? 'Fechar os tipos' : 'Ver os tipos de protocolo'}>
          <td className="left"><span style={{ display: 'inline-block', width: 14 }}>{aberto ? '▾' : '▸'}</span>{a.agente}</td>
          <td className="left">{a.equipe || '—'}</td>
          <td className="right" style={fundo ? { background: fundo, color: corDoTexto(fundo) } : undefined}>{int(a.protocolos)}</td>
          <td className="right">{int(a.tipos)}</td>
        </tr>
        {aberto && (a.porTipo || []).map((t) => (
          <tr key={`${chave}|${t.tipo}`} className="sub">
            <td className="left" style={{ paddingLeft: 30, color: 'var(--pbi-muted)' }}>{t.tipo}</td>
            <td />
            <td className="right">{int(t.protocolos)}</td>
            <td />
          </tr>
        ))}
      </Fragment>
    );
  };

  return (
    <div className="tbl-wrap">
      <table className="pbi">
        <thead>
          <tr>
            <th className="left" style={{ width: 300 }} onClick={() => ordenarPor('agente')}>Agente{seta('agente')}</th>
            <th className="left" onClick={() => ordenarPor('equipe')}>Equipe{seta('equipe')}</th>
            <th onClick={() => ordenarPor('protocolos')}>Protocolos{seta('protocolos')}</th>
            <th onClick={() => ordenarPor('tipos')}>Tipos de protocolo{seta('tipos')}</th>
          </tr>
        </thead>
        <tbody>
          {agentes.map(linhaAgente)}
          {robos.length > 0 && (
            <tr>
              <td colSpan={4} className="left" style={{ fontWeight: 700, color: 'var(--pbi-muted)', borderTop: '2px solid var(--pbi-gold-soft)' }}>
                Fora do ranking — agente virtual (robô)
              </td>
            </tr>
          )}
          {robos.map(linhaAgente)}
        </tbody>
      </table>
    </div>
  );
}

export function Produtividade() {
  const padrao = usePeriodoPadrao({ geral: true });
  const inicio = useInicioGeral();
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
    agente: lista('agente'),
  };

  const opcoes = useProdutividadeFiltros(periodo);
  const consulta = useProdutividade(visao, filtros);
  const dados = consulta.data || [];

  const colunas = useMemo(() => {
    // a do Elleven é a TabelaElleven, com expansão por tipo
    const comuns = [
      {
        key: 'agente',
        titulo: 'Agente',
        align: 'left',
        largura: 260,
        fmt: (v, d) => (d.semCorrespondencia ? `${v} (sem cadastro no CRM)` : v),
      },
      { key: 'atendimentos', titulo: 'Atendimentos', fmt: int, corFundo: comHeatmap(dados, 'atendimentos') },
      { key: 'tmaSeg', titulo: 'TMA médio', fmt: hmsSeg, corFundo: comHeatmap(dados, 'tmaSeg') },
      { key: 'tmeSeg', titulo: 'TME médio', fmt: hmsSeg, corFundo: comHeatmap(dados, 'tmeSeg') },
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
        <FiltroPeriodo de={valores.de} ate={valores.ate} min={inicio} onChange={(de, ate) => { definirVarios({ de, ate }); }} />
        <Filtro nome="Agente" opcoes={opcoes.data?.agente || []} marcados={lista('agente')} onChange={(v) => definir('agente', v)} />
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
          {dados.length ? `${int(dados.filter((d) => !d.semCorrespondencia && !d.robo).length)} agentes no período` : ''}
        </span>
      </div>

      <Visual
        className="v-matriz"
        title={atual.titulo}
        sub={visao === 'elleven'
          ? 'Protocolos abertos no Elleven por quem os criou · clique no agente para ver os tipos'
          : 'TMA e TME em média; tempo logado e de pausa são médias por dia (pausa: dias com pausa) · quem não tem cadastro no CRM fica na última linha'}
        flush
      >
        {consulta.isLoading ? <Loading />
          : consulta.isError ? <Erro erro={consulta.error} />
          : !dados.length ? <Vazio />
          : visao === 'elleven' ? <TabelaElleven dados={dados} />
          : (
            <Tabela
              dados={dados}
              colunas={colunas}
              ordemInicial={{ key: 'atendimentos', dir: 'desc' }}
              fixoNoFim={fixoNoFim}
            />
          )}
      </Visual>
    </div>
  );
}
