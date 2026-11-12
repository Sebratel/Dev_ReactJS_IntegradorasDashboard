import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuartis, useQuartisFiltros } from '../api';
import { CORES, CORES_QUARTIL, corDoTexto } from '../components/charts';
import { Filtro, useFiltros } from '../components/SlicerBar';
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
 * Área, Time e Supervisor vêm da Senior (db_senior_collaborators), não da planilha
 * do Google Sheets da origem (DN-02). A área define quem entra no ranking; Time,
 * Supervisor e Agente só filtram as linhas, a não ser que "Quartis: No recorte"
 * esteja ligado (D-01, D-18).
 *
 * Slicers de métrica do Power BI (D-08, DN-13): Status Matrix (TMA/TME Matrix), Nota
 * Pesquisa (CSAT e adesão CSAT Matrix), Pergunta CSAT (abre na do atendimento) e
 * Tipos de Protocolo (adesão Elleven). Eles mudam os valores e o ranking da área.
 */

const SEM_DADO = CORES.fundoNeutro;

/** Igual a AREA_PADRAO do servidor (model/quartis.js). */
const AREA_PADRAO = 'SUPORTE TÉCNICO';

/**
 * Pergunta do CSAT Matrix com que a tela abre (DN-09, DN-13). Igual a
 * PERGUNTA_ATENDIMENTO do servidor (model/produtividade.js), que também a usa
 * quando o pedido vem sem pergunta. Limpar o filtro volta para ela.
 */
const PERGUNTA_PADRAO = 'Como você se sentiu em relação ao atendimento da pessoa que falou com você?';

// ------------------------------------------------------------------ período (D-02)

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** Primeiro mês que o painel mostra (D-11: dados a partir de 01/01/2026). */
const PRIMEIRO_MES = new Date(2026, 0, 1);
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Meses fechados, do mais recente para o mais antigo (de/ate inclusivos). */
function mesesFechados() {
  const hoje = new Date();
  const lista = [];
  for (let d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); d >= PRIMEIRO_MES; d = new Date(d.getFullYear(), d.getMonth() - 1, 1)) {
    lista.push({
      label: `${MESES[d.getMonth()]}/${d.getFullYear()}`,
      de: isoLocal(d),
      ate: isoLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    });
  }
  return lista;
}

/**
 * Período dos QUARTIS (DN-12): só "mês fechado" ou "período digitado". Sem janela
 * móvel nem mês corrente, que misturam meses incompletos e mudam o ranking a cada
 * dia. A tela abre no último mês fechado.
 */
function PeriodoQuartis({ de, ate, onChange }) {
  const meses = useMemo(mesesFechados, []);
  const mesMarcado = meses.find((m) => m.de === de && m.ate === ate);
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState(mesMarcado ? 'mes' : 'periodo');
  const ref = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const rotulo = mesMarcado
    ? `Mês ${mesMarcado.label}`
    : `${de.split('-').reverse().join('/')} — ${ate.split('-').reverse().join('/')}`;
  const piso = isoLocal(PRIMEIRO_MES);

  return (
    <div className="filtro ativo" ref={ref}>
      <button type="button" onClick={() => setAberto((a) => !a)}>
        <span className="nome">Período</span>
        <span className="valor" style={{ maxWidth: 200 }}>{rotulo}</span>
        <span className="seta">▾</span>
      </button>
      {aberto && (
        <div className="pop pop-periodo">
          <div className="presets">
            <button type="button" className={modo === 'mes' ? 'on' : ''} onClick={() => setModo('mes')}>Mês fechado</button>
            <button type="button" className={modo === 'periodo' ? 'on' : ''} onClick={() => setModo('periodo')}>Período digitado</button>
          </div>
          {modo === 'mes' ? (
            <div className="presets">
              {meses.map((m) => (
                <button
                  key={m.de}
                  type="button"
                  className={mesMarcado?.de === m.de ? 'on' : ''}
                  onClick={() => { onChange(m.de, m.ate); setAberto(false); }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="datas">
              <input type="date" value={de} min={piso} max={ate} onChange={(e) => e.target.value && onChange(e.target.value, ate)} />
              <span>até</span>
              <input type="date" value={ate} min={de} onChange={(e) => e.target.value && onChange(de, e.target.value)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ordenação (D-21)

const ORDEM_Q = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };

/** Valor de ordenação de uma coluna; null/undefined vão sempre para o fim. */
function chaveOrdem(c, coluna) {
  if (coluna === 'colaborador') return c.colaborador || null;
  if (coluna === 'indicadores') return c.indicadoresContados ?? null;
  if (coluna === 'notaFinal') return c.notaFinal ?? null;
  if (coluna === 'quartilFinal') return ORDEM_Q[c.quartilFinal] ?? null;
  if (coluna.startsWith('q:')) return ORDEM_Q[c.quartis?.[coluna.slice(2)]] ?? null;
  return c[coluna] ?? null; // tempos em segundos e percentuais como número
}

function ordenar(lista, { coluna, direcao }) {
  const sinal = direcao === 'asc' ? 1 : -1;
  return [...lista].sort((a, b) => {
    const va = chaveOrdem(a, coluna);
    const vb = chaveOrdem(b, coluna);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'string') return sinal * va.localeCompare(vb, 'pt-BR');
    return sinal * (va - vb);
  });
}

function Cabecalho({ coluna, ordem, onOrdenar, className, title, children }) {
  const ativo = ordem.coluna === coluna;
  return (
    <th
      className={className}
      title={title}
      onClick={() => onOrdenar(coluna)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      aria-sort={ativo ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {children}{ativo ? (ordem.direcao === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

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
function MatrizQuartis({ indicadores, colaboradores: brutos }) {
  // abre pela nota final, da maior para a menor; o nome abre em ordem alfabética
  const [ordem, setOrdem] = useState({ coluna: 'notaFinal', direcao: 'desc' });
  const onOrdenar = (coluna) => setOrdem((o) => (o.coluna === coluna
    ? { coluna, direcao: o.direcao === 'asc' ? 'desc' : 'asc' }
    : { coluna, direcao: coluna === 'colaborador' ? 'asc' : 'desc' }));
  const colaboradores = useMemo(() => ordenar(brutos, ordem), [brutos, ordem]);

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
            <Cabecalho coluna="colaborador" ordem={ordem} onOrdenar={onOrdenar} className="rowhead">Colaborador</Cabecalho>
            <Cabecalho coluna="indicadores" ordem={ordem} onOrdenar={onOrdenar} title="Quantos indicadores com peso tinham dado no período">Ind.</Cabecalho>
            {indicadores.map((i) => [
              <Cabecalho key={i.campo} coluna={i.campo} ordem={ordem} onOrdenar={onOrdenar} title={`${i.menorEhMelhor ? 'Menor é melhor' : 'Maior é melhor'} · peso ${i.peso}`}>
                {i.rotulo}{i.peso === 0 ? ' *' : ''}
              </Cabecalho>,
              <Cabecalho key={`${i.campo}-q`} coluna={`q:${i.campo}`} ordem={ordem} onOrdenar={onOrdenar}>Q</Cabecalho>,
            ])}
            <Cabecalho coluna="notaFinal" ordem={ordem} onOrdenar={onOrdenar} className="total">Nota final</Cabecalho>
            <Cabecalho coluna="quartilFinal" ordem={ordem} onOrdenar={onOrdenar} className="total">QF</Cabecalho>
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
  // abre no último mês fechado (DN-12)
  const ultimoMes = useMemo(() => mesesFechados()[0] || {
    de: isoLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    ate: isoLocal(new Date()),
  }, []);
  // a área define quem entra no ranking; abre no Suporte Técnico (DN-02, DN-11)
  const { valores, definir, definirVarios, limpar, lista, temFiltro } = useFiltros({
    de: ultimoMes.de, ate: ultimoMes.ate, area: AREA_PADRAO, pergunta: PERGUNTA_PADRAO,
  });

  const periodo = { de: valores.de, ate: valores.ate };
  const recalcular = valores.recalcular === '1';
  const filtros = {
    ...periodo,
    servico: lista('servico'),
    ativoReceptivo: lista('ativoReceptivo'),
    fila: lista('fila'),
    sentido: lista('sentido'),
    status: lista('status'),
    nota: lista('nota'),
    pergunta: lista('pergunta'),
    tipoProtocolo: lista('tipoProtocolo'),
    area: lista('area'),
    time: lista('time'),
    supervisor: lista('supervisor'),
    agente: lista('agente'),
    recalcular: recalcular ? '1' : '',
  };

  const opcoes = useQuartisFiltros(periodo);
  const consulta = useQuartis(filtros);
  // opções da Senior vêm junto com a tabela; mantém as últimas enquanto recarrega
  const ultimasOpcoes = useRef({});
  if (consulta.data?.opcoes) ultimasOpcoes.current = consulta.data.opcoes;
  const senior = ultimasOpcoes.current;
  const indicadores = consulta.data?.indicadores || [];
  const colaboradores = consulta.data?.colaboradores || [];
  const ranking = consulta.data?.ranking;
  const comPeso = indicadores.filter((i) => i.peso > 0);

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <PeriodoQuartis de={valores.de} ate={valores.ate} onChange={(de, ate) => { definirVarios({ de, ate }); }} />
        <Filtro nome="Área" opcoes={senior.area || [AREA_PADRAO]} marcados={lista('area')} onChange={(v) => definir('area', v)} />
        <Filtro nome="Time" opcoes={senior.time || []} marcados={lista('time')} onChange={(v) => definir('time', v)} />
        <Filtro nome="Supervisor" opcoes={senior.supervisor || []} marcados={lista('supervisor')} onChange={(v) => definir('supervisor', v)} />
        <Filtro nome="Agente" opcoes={senior.agente || []} marcados={lista('agente')} onChange={(v) => definir('agente', v)} />
        <div className={`filtro${recalcular ? ' ativo' : ''}`}>
          <button
            type="button"
            title="Pela área: o quartil de cada um é o da área inteira; Time, Supervisor e Agente só escondem linhas. No recorte: os quartis são recalculados só com quem está filtrado, como o Power BI faz ao filtrar o supervisor."
            onClick={() => definir('recalcular', recalcular ? '' : '1')}
          >
            <span className="nome">Quartis</span>
            <span className="valor">{recalcular ? 'No recorte' : 'Pela área'}</span>
          </button>
        </div>
        <Filtro nome="Serviço Matrix" opcoes={opcoes.data?.servico || []} marcados={lista('servico')} onChange={(v) => definir('servico', v)} />
        <Filtro nome="At/Rec Matrix" opcoes={opcoes.data?.ativoReceptivo || []} marcados={lista('ativoReceptivo')} onChange={(v) => definir('ativoReceptivo', v)} />
        <Filtro nome="Fila Native" opcoes={opcoes.data?.fila || []} marcados={lista('fila')} onChange={(v) => definir('fila', v)} />
        <Filtro nome="Sentido Native" opcoes={opcoes.data?.sentido || []} marcados={lista('sentido')} onChange={(v) => definir('sentido', v)} />
        <Filtro nome="Status Matrix" opcoes={opcoes.data?.status || []} marcados={lista('status')} onChange={(v) => definir('status', v)} />
        <Filtro nome="Nota Pesquisa" opcoes={opcoes.data?.nota || []} marcados={lista('nota')} onChange={(v) => definir('nota', v)} />
        <Filtro nome="Pergunta CSAT" opcoes={opcoes.data?.pergunta || [PERGUNTA_PADRAO]} marcados={lista('pergunta')} onChange={(v) => definir('pergunta', v)} />
        <Filtro nome="Tipos de Protocolo" opcoes={opcoes.data?.tipoProtocolo || []} marcados={lista('tipoProtocolo')} onChange={(v) => definir('tipoProtocolo', v)} />
        {temFiltro && <button type="button" className="limpar" onClick={limpar}>Limpar filtros</button>}
      </div>

      <Visual
        className="v-matriz"
        title="Desempenho colaboradores por quartis"
        sub={`${int(colaboradores.length)} colaboradores`
          + (ranking ? ` · quartis ${ranking.recalculado ? 'recalculados no recorte' : `pela área ${ranking.areas.join(', ')}`} (${int(ranking.populacao)} no ranking)` : '')
          + ' · nota ponderada pelos pesos de workloads_quartiles'
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
