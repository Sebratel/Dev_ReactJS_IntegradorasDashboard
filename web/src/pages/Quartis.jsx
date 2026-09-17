import { useQuartis, useProdutividadeFiltros } from '../api';
import { CORES, CORES_QUARTIL, corDoTexto } from '../components/charts';
import { Filtro, FiltroPeriodo, usePeriodoPadrao, useFiltros } from '../components/SlicerBar';
import { Erro, Loading, useExportavel, Vazio, Visual } from '../components/ui';
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

const SEM_DADO = CORES.fundoNeutro;

const valorFormatado = (v, formato) => {
  if (v === null || v === undefined) return '—';
  return formato === 'percentual' ? pct(v, 1) : hmsSeg(v);
};

function Celula({ valor, formato }) {
  return <td className="right">{valorFormatado(valor, formato)}</td>;
}

function CelulaQuartil({ q }) {
  const fundo = q ? CORES_QUARTIL[q] : SEM_DADO;
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

/**
 * A matriz é componente próprio por causa da exportação: o slot do cabeçalho
 * vive DENTRO do `Visual`, e só um filho dele enxerga o contexto — a página,
 * que é quem renderiza o `Visual`, ficaria de fora.
 *
 * No CSV cada indicador vira duas colunas (valor e quartil), como na tela, e
 * entra o e-mail, que na tela é só título da célula. Num arquivo que vai virar
 * planilha de RH, saber de quem é a linha vale mais que economizar coluna.
 */
function MatrizQuartis({ indicadores, colaboradores }) {
  useExportavel(null, () => {
    if (!colaboradores.length) return null;
    const colunas = [
      { key: 'colaborador', titulo: 'Colaborador' },
      { key: 'email', titulo: 'E-mail', fmt: (v) => v || '—' },
      {
        key: 'indicadoresContados',
        titulo: 'Indicadores na nota',
        fmt: (_v, d) => `${d.indicadoresContados}/${d.indicadoresPossiveis}`,
      },
    ];
    for (const i of indicadores) {
      colunas.push({
        key: i.campo,
        titulo: i.rotulo + (i.peso === 0 ? ' *' : ''),
        fmt: (v) => valorFormatado(v, i.formato),
      });
      colunas.push({
        key: `quartil_${i.campo}`,
        titulo: `${i.rotulo} (quartil)`,
        fmt: (_v, d) => d.quartis?.[i.campo] || '—',
      });
    }
    colunas.push({ key: 'notaFinal', titulo: 'Nota final', fmt: (v) => (v === null ? '—' : pct(v, 1)) });
    colunas.push({ key: 'quartilFinal', titulo: 'Quartil final', fmt: (v) => v || '—' });
    return { colunas, linhas: colaboradores };
  });

  return (
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
  );
}

export function Quartis() {
  const padrao = usePeriodoPadrao();
  const { valores, definir, definirVarios, limpar, lista, temFiltro } = useFiltros({ de: padrao.de, ate: padrao.ate });

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
        <FiltroPeriodo de={valores.de} ate={valores.ate} onChange={(de, ate) => { definirVarios({ de, ate }); }} />
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
          : <MatrizQuartis indicadores={indicadores} colaboradores={colaboradores} />}
      </Visual>
    </div>
  );
}
