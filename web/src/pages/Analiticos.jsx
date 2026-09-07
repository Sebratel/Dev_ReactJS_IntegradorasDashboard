import { useRef } from 'react';
import {
  useAnaliticoAtendimento, useAnaliticoCx, useAnaliticoCxDetalhe, useAnaliticoHsm, useAnaliticosFiltros,
} from '../api';
import { CORES, ComboChart } from '../components/charts';
import { useAlturaNoCromo } from '../components/cromo';
import { Filtro, FiltroPeriodo, usePeriodoPadrao, useFiltros } from '../components/SlicerBar';
import { Tabela } from '../components/tables';
import { Erro, Kpi, Legenda, Loading, Vazio, Visual } from '../components/ui';
import { BotaoInsights } from '../components/InsightsIA';
import { dataBr, horaBr, hmsSeg, int, pct } from '../format';

/**
 * As três telas que a aplicação `dev_ReactJs_DashboardUX` mostra hoje.
 *
 * Lá o analítico de atendimento e o de HSM são RASPADOS da interface web do
 * MatrixGO com Playwright e o CX vem da API do Data Hub (com token e limite de
 * requisição); depois o CSV é parseado no navegador. Os três já existem prontos no
 * MariaDB, atualizados até hoje, então aqui é SQL direto — sem navegador, sem CSV
 * e sem token, que é o "de forma automática" pedido. Ver `model/analiticos.js`.
 */

function FaixaKpis({ itens, refFaixa }) {
  return (
    <div className="kpi-faixa" ref={refFaixa}>
      {itens.map((k) => <Kpi key={k.label} value={k.value} label={k.label} desc={k.desc} />)}
    </div>
  );
}

function Painel({ titulo, sub, consulta, dados, colunas, ordemInicial }) {
  return (
    <Visual className="v-tabela" title={titulo} sub={sub} flush>
      {consulta.isLoading ? <Loading />
        : consulta.isError ? <Erro erro={consulta.error} />
        : !dados?.length ? <Vazio />
        : <Tabela dados={dados.map((d, i) => ({ ...d, __key: `${d.chave}-${i}` }))} colunas={colunas} ordemInicial={ordemInicial} />}
    </Visual>
  );
}

/** Coluna de barra de dados sobre o maior valor da própria coluna. */
const colBarra = (key, titulo, fmt = int) => ({ key, titulo, fmt, databar: { cor: CORES.gold600 } });

// -------------------------------------------------------------- ATENDIMENTO

export function AnaliticoAtendimento() {
  const padrao = usePeriodoPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({ de: padrao.de, ate: padrao.ate });
  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = {
    ...periodo,
    status: lista('status'),
    canal: lista('canal'),
    ativoReceptivo: lista('ativoReceptivo'),
  };

  const opcoes = useAnaliticosFiltros(periodo);
  const consulta = useAnaliticoAtendimento(filtros);
  const d = consulta.data;
  const k = d?.kpis || {};

  const refKpis = useRef(null);
  useAlturaNoCromo(refKpis, '--h-kpis');

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo de={valores.de} ate={valores.ate} onChange={(de, ate) => { definir('de', de); definir('ate', ate); }} />
        <Filtro nome="Status" opcoes={opcoes.data?.status || []} marcados={lista('status')} onChange={(v) => definir('status', v)} />
        <Filtro nome="Canal" opcoes={opcoes.data?.canal || []} marcados={lista('canal')} onChange={(v) => definir('canal', v)} />
        <Filtro nome="Ativo/Receptivo" opcoes={opcoes.data?.ativoReceptivo || []} marcados={lista('ativoReceptivo')} onChange={(v) => definir('ativoReceptivo', v)} />
        {temFiltro && <button type="button" className="limpar" onClick={limpar}>Limpar filtros</button>}
      </div>

      <FaixaKpis
        refFaixa={refKpis}
        itens={[
          { label: 'Atendimentos', value: int(k.total ?? 0), desc: 'Total no período' },
          { label: 'Finalizados', value: int(k.finalizados ?? 0), desc: k.total ? `${pct(k.finalizados / k.total, 1)} do total` : '—' },
          { label: 'Transferidos', value: int(k.transferidos ?? 0), desc: 'Inclui fila prioritária' },
          { label: 'Automáticos', value: int(k.automatico ?? 0), desc: 'Resolvidos pelo bot' },
          { label: 'Por inatividade', value: int(k.inatividade ?? 0), desc: 'Cliente não respondeu' },
        ]}
      />

      <Visual
        className="v-grafico"
        title="Atendimentos por dia"
        sub="Total e finalizados"
        actions={<BotaoInsights visual="analiticos-atendimento:geral" titulo="Analítico de Atendimento" filtros={filtros} />}
      >
        {consulta.isLoading ? <Loading />
          : consulta.isError ? <Erro erro={consulta.error} />
          : !d?.porDia?.length ? <Vazio />
          : (
            <>
              <Legenda itens={[{ label: 'Total', cor: CORES.gold }, { label: 'Finalizados', cor: CORES.primary }]} />
              <ComboChart
                data={d.porDia}
                barras={[
                  { key: 'total', nome: 'Total', cor: CORES.gold },
                  { key: 'finalizados', nome: 'Finalizados', cor: CORES.primary },
                ]}
              />
            </>
          )}
      </Visual>

      <div className="grid linha-dupla">
        <Painel
          titulo="Por fila"
          sub="Espera e atendimento médios de cada fila"
          consulta={consulta}
          dados={d?.porFila}
          ordemInicial={{ key: 'n', dir: 'desc' }}
          colunas={[
            { key: 'chave', titulo: 'Fila', align: 'left', largura: 260 },
            colBarra('n', 'Atendimentos'),
            { key: 'esperaSeg', titulo: 'Espera média', fmt: hmsSeg },
            { key: 'atendimentoSeg', titulo: 'Atendimento médio', fmt: hmsSeg },
          ]}
        />
        <Painel
          titulo="Por status"
          sub="Volume e tempo médio de cada desfecho"
          consulta={consulta}
          dados={d?.tempoPorStatus}
          ordemInicial={{ key: 'n', dir: 'desc' }}
          colunas={[
            { key: 'chave', titulo: 'Status', align: 'left', largura: 220 },
            colBarra('n', 'Qtd'),
            { key: 'atendimentoSeg', titulo: 'Atendimento médio', fmt: hmsSeg },
          ]}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- HSM

export function AnaliticoHsm() {
  const padrao = usePeriodoPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({ de: padrao.de, ate: padrao.ate });
  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = { ...periodo, template: lista('template'), categoria: lista('categoria') };

  const opcoes = useAnaliticosFiltros(periodo);
  const consulta = useAnaliticoHsm(filtros);
  const d = consulta.data;
  const k = d?.kpis || {};

  const refKpis = useRef(null);
  useAlturaNoCromo(refKpis, '--h-kpis');

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo de={valores.de} ate={valores.ate} onChange={(de, ate) => { definir('de', de); definir('ate', ate); }} />
        <Filtro nome="Template" opcoes={opcoes.data?.template || []} marcados={lista('template')} onChange={(v) => definir('template', v)} />
        <Filtro nome="Categoria" opcoes={opcoes.data?.categoria || []} marcados={lista('categoria')} onChange={(v) => definir('categoria', v)} />
        {temFiltro && <button type="button" className="limpar" onClick={limpar}>Limpar filtros</button>}
      </div>

      <FaixaKpis
        refFaixa={refKpis}
        itens={[
          { label: 'Enviadas', value: int(k.enviadas ?? 0), desc: 'Disparos no período' },
          { label: 'Entregues', value: int(k.entregues ?? 0), desc: k.taxaEntrega === null || k.taxaEntrega === undefined ? '—' : `${pct(k.taxaEntrega, 1)} das enviadas` },
          { label: 'Lidas', value: int(k.lidas ?? 0), desc: k.entregues ? `${pct(k.lidas / k.entregues, 1)} das entregues` : '—' },
          { label: 'Falhas', value: int(k.falhas ?? 0), desc: 'Não chegaram ao cliente' },
        ]}
      />

      <Visual
        className="v-grafico"
        title="Mensagens por dia"
        sub="Enviadas, entregues e lidas"
        actions={<BotaoInsights visual="analiticos-hsm:geral" titulo="Mensagens HSM" filtros={filtros} />}
      >
        {consulta.isLoading ? <Loading />
          : consulta.isError ? <Erro erro={consulta.error} />
          : !d?.porDia?.length ? <Vazio />
          : (
            <>
              <Legenda
                itens={[
                  { label: 'Enviadas', cor: CORES.gold },
                  { label: 'Entregues', cor: CORES.primary },
                  { label: 'Lidas', cor: CORES.ink, linha: true },
                ]}
              />
              <ComboChart
                data={d.porDia}
                barras={[
                  { key: 'enviadas', nome: 'Enviadas', cor: CORES.gold },
                  { key: 'entregues', nome: 'Entregues', cor: CORES.primary },
                ]}
                linhas={[{ key: 'lidas', nome: 'Lidas', cor: CORES.ink }]}
              />
            </>
          )}
      </Visual>

      <div className="grid linha-dupla">
        <Painel
          titulo="Por template"
          sub="Taxa de leitura sobre o que foi enviado"
          consulta={consulta}
          dados={d?.porTemplate}
          ordemInicial={{ key: 'enviadas', dir: 'desc' }}
          colunas={[
            { key: 'chave', titulo: 'Template', align: 'left', largura: 260 },
            { key: 'categoria', titulo: 'Categoria', align: 'left' },
            colBarra('enviadas', 'Enviadas'),
            { key: 'lidas', titulo: 'Lidas', fmt: int },
            { key: 'taxaLeitura', titulo: '% leitura', fmt: (v) => (v === null ? '—' : pct(v, 1)) },
            { key: 'falhas', titulo: 'Falhas', fmt: int },
          ]}
        />
        <Painel
          titulo="Motivos de falha"
          sub="O motivo é o próprio status devolvido pela plataforma"
          consulta={consulta}
          dados={d?.falhas}
          ordemInicial={{ key: 'n', dir: 'desc' }}
          colunas={[
            { key: 'chave', titulo: 'Motivo', align: 'left', largura: 280 },
            colBarra('n', 'Mensagens'),
          ]}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------- CX

export function AnaliticoCx() {
  const padrao = usePeriodoPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({ de: padrao.de, ate: padrao.ate });
  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = { ...periodo, fluxo: lista('fluxo'), cidade: lista('cidade') };

  const opcoes = useAnaliticosFiltros(periodo);
  const consulta = useAnaliticoCx(filtros);
  const detalhe = useAnaliticoCxDetalhe(filtros);
  const d = consulta.data;
  const k = d?.kpis || {};

  const refKpis = useRef(null);
  useAlturaNoCromo(refKpis, '--h-kpis');

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo de={valores.de} ate={valores.ate} onChange={(de, ate) => { definir('de', de); definir('ate', ate); }} />
        <Filtro nome="Fluxo" opcoes={opcoes.data?.fluxo || []} marcados={lista('fluxo')} onChange={(v) => definir('fluxo', v)} />
        <Filtro nome="Cidade" opcoes={opcoes.data?.cidade || []} marcados={lista('cidade')} onChange={(v) => definir('cidade', v)} />
        {temFiltro && <button type="button" className="limpar" onClick={limpar}>Limpar filtros</button>}
      </div>

      <FaixaKpis
        refFaixa={refKpis}
        itens={[
          { label: 'Disparos', value: int(k.disparos ?? 0), desc: 'Mensagens automáticas no período' },
          { label: 'Sucesso', value: int(k.sucesso ?? 0), desc: k.taxaSucesso === null || k.taxaSucesso === undefined ? '—' : `${pct(k.taxaSucesso, 1)} dos disparos` },
          { label: 'Falha', value: int(k.falha ?? 0), desc: 'Não saíram (token, contato ativo…)' },
          { label: 'Contratos', value: int(k.contratos ?? 0), desc: 'Clientes distintos alcançados' },
        ]}
      />

      <Visual
        className="v-grafico"
        title="Disparos por dia"
        sub="A tabela guarda três fluxos do n8n — use o filtro para isolar o CX pós-instalação (cs_cx_72hrs)"
        actions={<BotaoInsights visual="analiticos-cx:geral" titulo="CX Pós-Instalação" filtros={filtros} />}
      >
        {consulta.isLoading ? <Loading />
          : consulta.isError ? <Erro erro={consulta.error} />
          : !d?.porDia?.length ? <Vazio />
          : (
            <>
              <Legenda itens={[{ label: 'Sucesso', cor: CORES.gold }, { label: 'Falha', cor: CORES.critico }]} />
              <ComboChart
                data={d.porDia}
                barras={[
                  { key: 'sucesso', nome: 'Sucesso', cor: CORES.gold },
                  { key: 'falha', nome: 'Falha', cor: CORES.critico },
                ]}
              />
            </>
          )}
      </Visual>

      <div className="grid linha-dupla">
        <Painel
          titulo="Por fluxo"
          sub="Cada automação do n8n e sua taxa de sucesso"
          consulta={consulta}
          dados={d?.porFluxo}
          ordemInicial={{ key: 'disparos', dir: 'desc' }}
          colunas={[
            { key: 'chave', titulo: 'Fluxo', align: 'left', largura: 260 },
            colBarra('disparos', 'Disparos'),
            { key: 'sucesso', titulo: 'Sucesso', fmt: int },
            { key: 'taxa', titulo: '% sucesso', fmt: (v) => (v === null ? '—' : pct(v, 1)) },
          ]}
        />
        <Visual className="v-tabela" title="Detalhamento" sub="Disparos mais recentes do recorte" flush>
          {detalhe.isLoading ? <Loading />
            : detalhe.isError ? <Erro erro={detalhe.error} />
            : !detalhe.data?.length ? <Vazio />
            : (
              <Tabela
                dados={detalhe.data.map((r, i) => ({ ...r, __key: `${r.prot_atendimento}-${i}` }))}
                colunas={[
                  { key: 'data_hora_disparo', titulo: 'Disparo', align: 'left', fmt: (v) => `${dataBr(v)} ${horaBr(v)}` },
                  { key: 'cliente_nome', titulo: 'Cliente', align: 'left', largura: 190 },
                  { key: 'cliente_cidade', titulo: 'Cidade', align: 'left', fmt: (v) => v || '—' },
                  {
                    key: 'status_envio',
                    titulo: 'Envio',
                    align: 'center',
                    fmt: (v) => (Number(v) === 1 ? 'ok' : 'falha'),
                    corFundo: (r) => (Number(r.status_envio) === 1 ? CORES.fundoPositivo : CORES.fundoAtencao),
                  },
                  { key: 'mensagem_envio', titulo: 'Retorno', align: 'left', fmt: (v) => (v || '—').slice(0, 60) },
                ]}
              />
            )}
        </Visual>
      </div>
    </div>
  );
}
