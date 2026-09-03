import { useQuartis, useProdutividadeFiltros } from '../api';
import { corDoTexto } from '../components/charts';
import { Filtro, FiltroPeriodo, periodoPadrao, useFiltros } from '../components/SlicerBar';
import { Erro, Loading, Vazio, Visual } from '../components/ui';
import { hmsSeg, int, pct } from '../format';

/**
 * DESEMPENHO COLABORADORES POR QUARTIS (página `60ab68847ffd5d30b107`).
 *
 * Tabela larga: colaborador + 11 pares indicador/quartil + nota final. Cada célula
 * de quartil é pintada pela cor do próprio quartil, como as medidas `Cor_*` do
 * modelo; o texto sai da luminância do fundo (o amarelo do Q2 pede texto escuro, o
 * vermelho do Q4 pede claro).
 *
 * O slicer SUPERVISOR da origem vem de uma planilha do Google Sheets e não foi
 * portado — precisaria de credencial de API própria.
 */

const COR_QUARTIL = { Q1: '#00B050', Q2: '#FFFF00', Q3: '#FFC000', Q4: '#FF0000' };
const SEM_DADO = '#F3F2F1';

const valorFormatado = (v, formato) => {
  if (v === null || v === undefined) return '—';
  return formato === 'percentual' ? pct(v, 1) : hmsSeg(v);
};

function Celula({ valor, formato }) {
  return <td className="right">{valorFormatado(valor, formato)}</td>;
}

function CelulaQuartil({ q }) {
  const fundo = q ? COR_QUARTIL[q] : SEM_DADO;
  return (
    <td
      className="center"
      style={{ background: fundo, color: q ? corDoTexto(fundo) : 'var(--pbi-muted)', fontWeight: 700 }}
      title={q ? `Quartil ${q.slice(1)}` : 'Sem dado no período — este indicador não entra na nota'}
    >
      {q || '—'}
    </td>
  );
}

export function Quartis() {
  const padrao = periodoPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({ de: padrao.de, ate: padrao.ate });

  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = {
    ...periodo,
    servico: lista('servico'),
    ativoReceptivo: lista('ativoReceptivo'),
    fila: lista('fila'),
    sentido: lista('sentido'),
  };

  const opcoes = useProdutividadeFiltros(periodo);
  const consulta = useQuartis(filtros);
  const indicadores = consulta.data?.indicadores || [];
  const colaboradores = consulta.data?.colaboradores || [];
  const comPeso = indicadores.filter((i) => i.peso > 0);

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo de={valores.de} ate={valores.ate} onChange={(de, ate) => { definir('de', de); definir('ate', ate); }} />
        <Filtro nome="Serviço Matrix" opcoes={opcoes.data?.servico || []} marcados={lista('servico')} onChange={(v) => definir('servico', v)} />
        <Filtro nome="At/Rec Matrix" opcoes={opcoes.data?.ativoReceptivo || []} marcados={lista('ativoReceptivo')} onChange={(v) => definir('ativoReceptivo', v)} />
        <Filtro nome="Fila Native" opcoes={opcoes.data?.fila || []} marcados={lista('fila')} onChange={(v) => definir('fila', v)} />
        <Filtro nome="Sentido Native" opcoes={opcoes.data?.sentido || []} marcados={lista('sentido')} onChange={(v) => definir('sentido', v)} />
        {temFiltro && <button type="button" className="limpar" onClick={limpar}>Limpar filtros</button>}
      </div>

      <Visual
        className="v-matriz"
        title="Desempenho colaboradores por quartis"
        sub={`${int(colaboradores.length)} colaboradores · nota ponderada pelos pesos de workloads_quartiles`
          + ` · ${comPeso.length} indicadores com peso (os marcados com * têm peso 0 e não entram na nota)`
          + ' · indicador sem dado no período sai da conta dos dois lados'}
        flush
      >
        {consulta.isLoading ? <Loading />
          : consulta.isError ? <Erro erro={consulta.error} />
          : !colaboradores.length ? <Vazio />
          : (
            <div className="tbl-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th className="rowhead">Colaborador</th>
                    <th title="Quantos indicadores com peso tinham dado no período">Ind.</th>
                    {indicadores.map((i) => [
                      <th key={i.campo} title={`${i.menorEhMelhor ? 'Menor é melhor' : 'Maior é melhor'} · peso ${i.peso}`}>
                        {i.rotulo}{i.peso === 0 ? ' *' : ''}
                      </th>,
                      <th key={`${i.campo}-q`}>Q</th>,
                    ])}
                    <th className="total">Nota final</th>
                    <th className="total">QF</th>
                  </tr>
                </thead>
                <tbody>
                  {colaboradores.map((c) => (
                    <tr key={c.email || c.colaborador}>
                      <td className="rowhead" title={c.email || undefined}>{c.colaborador}</td>
                      <td
                        className="center"
                        title={`${c.indicadoresContados} de ${c.indicadoresPossiveis} indicadores com peso entraram na nota`}
                        style={c.indicadoresContados < c.indicadoresPossiveis / 2
                          ? { color: 'var(--pbi-gold-600)', fontWeight: 700 }
                          : undefined}
                      >
                        {c.indicadoresContados}/{c.indicadoresPossiveis}
                      </td>
                      {indicadores.map((i) => [
                        <Celula key={i.campo} valor={c[i.campo]} formato={i.formato} />,
                        <CelulaQuartil key={`${i.campo}-q`} q={c.quartis[i.campo]} />,
                      ])}
                      <td className="total right">{c.notaFinal === null ? '—' : pct(c.notaFinal, 1)}</td>
                      <CelulaQuartil q={c.quartilFinal} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Visual>
    </div>
  );
}
