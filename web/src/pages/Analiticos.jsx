import { useRef, useState } from 'react';
import {
  useAnaliticoAtendimento, useAnaliticoCx, useAnaliticoCxCruzado, useAnaliticoHsm,
  useAnaliticoHsmFalhas, useAnaliticosFiltros,
} from '../api';
import { CORES, ComboChart } from '../components/charts';
import { useAlturaNoCromo } from '../components/cromo';
import { Filtro, FiltroPeriodo, usePeriodoPadrao, useFiltros } from '../components/SlicerBar';
import { Tabela } from '../components/tables';
import { Erro, Kpi, Legenda, Loading, Vazio, Visual } from '../components/ui';
import { BotaoInsights } from '../components/InsightsIA';
import {
  Aviso, BarraOkNok, BarrasTempo, COR_FAMILIA, CartaoGrupo, ColunasHora, Donut,
  Funil, Jornada, Leituras, ListaBarras, Pilulas, Proporcao, Secao,
} from '../components/analiticos';
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

function FaixaKpis({ itens, refFaixa = null }) {
  return (
    <div className="kpi-faixa" ref={refFaixa}>
      {itens.map((k) => <Kpi key={k.label} value={k.value} label={k.label} desc={k.desc} title={k.title} />)}
    </div>
  );
}

function Painel({ titulo, sub, consulta, dados, colunas, ordemInicial, className = 'v-tabela', actions = null }) {
  return (
    <Visual className={className} title={titulo} sub={sub} actions={actions} flush>
      {consulta.isLoading ? <Loading />
        : consulta.isError ? <Erro erro={consulta.error} />
        : !dados?.length ? <Vazio />
        : <Tabela dados={dados.map((d, i) => ({ ...d, __key: `${d.chave}-${i}` }))} colunas={colunas} ordemInicial={ordemInicial} />}
    </Visual>
  );
}

/**
 * Card de altura automática, para as telas que rolam.
 *
 * As outras onze telas do dashboard derivam a altura de `--util`, para caber numa
 * tela sem rolagem. Estas três rolam de propósito (decisão do usuário em
 * 08/09/2026, por fidelidade à app de origem), então prender o card a uma fração
 * da tela só cortaria conteúdo por dentro — cada card ocupa o que precisa.
 */
function Card({ titulo, sub, consulta, children, actions = null, vazio = false }) {
  return (
    <Visual className="v-auto" title={titulo} sub={sub} actions={actions}>
      {consulta?.isLoading ? <Loading />
        : consulta?.isError ? <Erro erro={consulta.error} />
        : vazio ? <Vazio />
        : children}
    </Visual>
  );
}

/** Coluna de barra de dados sobre o maior valor da própria coluna. */
const colBarra = (key, titulo, fmt = int) => ({ key, titulo, fmt, databar: { cor: CORES.gold600 } });

/** Segundos -> "3min 20s" / "1h 12m", como a app original escreve. */
function tempoCurto(seg) {
  if (seg === null || seg === undefined || seg <= 0) return '—';
  const m = Math.floor(seg / 60);
  const s = Math.round(seg % 60);
  if (m < 60) return m ? `${m}min ${s}s` : `${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

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
    <div className="page rola">
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
          { label: 'Automáticos', value: int(k.automatico ?? 0), desc: 'Status "Automático"' },
          { label: 'Por inatividade', value: int(k.inatividade ?? 0), desc: 'Cliente não respondeu' },
          { label: 'Sem tag', value: int(k.semTag ?? 0), desc: k.total ? `${pct(k.semTag / k.total, 1)} sem categoria` : '—' },
        ]}
      />

      <Aviso tom="neutro">
        <b>{int(k.passouSuporte ?? 0)}</b> atendimentos passaram por Suporte ou Financeiro no bot antes de
        encerrar · <b>{int(k.isaTotal ?? 0)}</b> foram encerrados automaticamente pela ISA
        {k.total ? ` (${pct(k.isaTotal / k.total, 1)} do total)` : ''}
      </Aviso>

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

      {/* ---------------- o que o bot resolveu ---------------- */}
      <Secao
        titulo="Resolução pelo bot"
        sub="Quanto a ISA fecha sozinha, em quais assuntos, e quanto ainda chega a um atendente."
      >
        <div className="grid linha-dupla">
          <CartaoGrupo
            titulo="Encerramentos ISA · Suporte Técnico"
            total={d?.isa?.total ?? 0}
            sub={d?.isa?.pct !== null && d?.isa?.pct !== undefined
              ? `${pct(d.isa.pct, 1)} dos atendimentos encerrados automaticamente pela ISA`
              : 'sem dados no período'}
            itens={d?.isa?.categorias}
            cor={CORES.primary}
          />
          <CartaoGrupo
            titulo="Marketing e MelhorPlano"
            total={d?.marketing?.total ?? 0}
            sub={d?.marketing?.pct !== null && d?.marketing?.pct !== undefined
              ? `${pct(d.marketing.pct, 1)} dos atendimentos · tags de campanha`
              : 'sem dados no período'}
            itens={d?.marketing?.itens?.slice(0, 8)}
            cor={CORES.gold600}
            vazio="Nenhuma tag de campanha no período. Elas existem na base desde jan/2026, mas em janelas específicas."
          />
        </div>

        {d?.efetividade && (
          <Proporcao
            titulo="Efetividade automática"
            valor={d.efetividade.taxa}
            sub={`${int(d.efetividade.automatico)} de ${int(k.total)} sem nenhum agente`}
            cor={CORES.gold}
            blocos={[
              { chave: 'Automático', n: d.efetividade.automatico, pct: k.total ? d.efetividade.automatico / k.total : 0, cor: CORES.gold },
              { chave: 'Misto', n: d.efetividade.misto, pct: k.total ? d.efetividade.misto / k.total : 0, cor: CORES.orange },
              { chave: 'Humano', n: d.efetividade.humano, pct: k.total ? d.efetividade.humano / k.total : 0, cor: CORES.primary },
              { chave: 'Notificação', n: d.efetividade.notificacao, pct: k.total ? d.efetividade.notificacao / k.total : 0, cor: CORES.blue },
            ]}
          />
        )}
      </Secao>

      {/* ---------------- motivo e composição ---------------- */}
      <Secao
        titulo="Motivo do contato e desfecho"
        sub="O assunto vem das tags: as ISA_* de pedido, as de menu e as de transbordo para humano. As tags de controle (encerramento, início, erro) ficam de fora — elas dizem o que o bot fez, não o que o cliente queria."
      >
        <div className="grid linha-dupla">
          <Card
            titulo="Motivo do contato"
            sub={`${d?.motivos?.length ? d.motivos.length - 1 : 0} assuntos distintos no período`}
            consulta={consulta}
            vazio={!d?.motivos?.length}
          >
            <ListaBarras
              itens={d?.motivos}
              max={12}
              corDe={(i) => COR_FAMILIA[i.familia] || CORES.gold}
            />
          </Card>

          <Card titulo="Status dos atendimentos" sub="Composição dos desfechos" consulta={consulta} vazio={!d?.porStatus?.length}>
            <Donut dados={d?.porStatus || []} />
          </Card>
        </div>

        <Card
          titulo="Volume de entradas por hora"
          sub="Hora de entrada no atendimento — mostra o pico de demanda do dia"
          consulta={consulta}
          vazio={!d?.porHora?.length}
        >
          <ColunasHora horas={d?.porHora} />
        </Card>
      </Secao>

      {/* ---------------- jornada e recorrência ---------------- */}
      <Secao
        titulo="Jornada e recorrência"
        sub="Cada linha é um caminho distinto de tags — a sequência que o cliente percorreu no bot — com o desfecho mais comum daquele caminho."
      >
        <Card
          titulo="Jornada do cliente no bot"
          sub="Caminho de cliques, do mais frequente ao menos"
          consulta={consulta}
          vazio={!d?.jornada?.length}
        >
          <Jornada caminhos={d?.jornada} max={12} />
        </Card>

        <div className="grid linha-dupla">
          <Card
            titulo="Perfil de recorrência"
            sub={d?.recorrencia?.total
              ? `${int(d.recorrencia.total)} atendimentos com recorrência registrada`
              : 'sem recorrência no período'}
            consulta={consulta}
            vazio={!d?.porRecorrencia?.length}
          >
            <Pilulas itens={d?.porRecorrencia} base={d?.recorrencia?.total} />
            <Aviso tom="neutro">
              A base grava a ocorrência no nome — <code>Reincidente (1)</code>, <code>(2)</code>, <code>(3)</code>.
              Aqui elas somam no mesmo grupo; a app de origem compara o nome exato e só conta as sem número.
            </Aviso>
          </Card>

          <Card titulo="Canal e tipo de atendimento" consulta={consulta} vazio={!d?.porCanal?.length}>
            <div className="an-secao">
              <h3>Canal</h3>
              <ListaBarras itens={d?.porCanal?.map((c) => ({ ...c, pct: k.total ? c.n / k.total : null }))} max={6} />
              <h3>Tipo</h3>
              <ListaBarras
                itens={d?.porTipo?.map((t) => ({ ...t, pct: k.total ? t.n / k.total : null }))}
                max={6}
                corDe={(_, i) => [CORES.gold, CORES.orange, CORES.primary, CORES.blue][i % 4]}
              />
            </div>
          </Card>
        </div>
      </Secao>

      {/* ---------------- tempos e leituras ---------------- */}
      <Secao titulo="Tempos e leituras" sub="Onde o tempo é gasto, e o que os números do período dizem.">
        <div className="grid linha-dupla">
          <Card
            titulo="Tempo médio de atendimento por status"
            sub="Média da duração, entre os que têm tempo registrado"
            consulta={consulta}
            vazio={!d?.tempoPorStatus?.length}
          >
            <BarrasTempo itens={d?.tempoPorStatus} fmt={tempoCurto} />
          </Card>

          <Painel
            titulo="Por fila"
            sub="Espera e atendimento médios de cada fila"
            className="v-auto"
            consulta={consulta}
            dados={d?.porFila?.slice(0, 12)}
            ordemInicial={{ key: 'n', dir: 'desc' }}
            colunas={[
              { key: 'chave', titulo: 'Fila', align: 'left', largura: 240 },
              colBarra('n', 'Atend.'),
              { key: 'esperaSeg', titulo: 'Espera', fmt: hmsSeg },
              { key: 'atendimentoSeg', titulo: 'Atendimento', fmt: hmsSeg },
            ]}
          />
        </div>

        <Card
          titulo="Leituras automáticas"
          sub="Contas fixas sobre os números desta tela — não é a leitura de IA, que fica no botão Insights do gráfico"
          consulta={consulta}
          vazio={!d?.insights}
        >
          <Leituras itens={leiturasDoAtendimento(d, k)} />
        </Card>
      </Secao>
    </div>
  );
}

/**
 * As seis leituras da app original, recalculadas sobre os agregados do servidor.
 *
 * Cada uma cita o número que a sustenta — leitura sem número é opinião. As que
 * dão zero são descartadas pelo componente, para o card não virar uma lista de
 * "nada aconteceu".
 */
function leiturasDoAtendimento(d, k) {
  if (!d?.insights) return [];
  const i = d.insights;
  const total = k.total || 1;
  return [
    {
      titulo: 'Inatividade noturna',
      valor: i.inatividadeNoturna,
      cor: CORES.critico,
      gravidade: 'critico',
      texto: `${int(i.inatividadeNoturna)} atendimentos entre 0h e 6h terminaram por inatividade — o cliente abre e não responde fora do horário comercial.`,
    },
    {
      titulo: 'Custo da inatividade',
      valor: i.mediaInatividadeSeg || 0,
      cor: CORES.orange,
      gravidade: 'atencao',
      texto: `Cada atendimento encerrado por inatividade ocupa o bot por ${tempoCurto(i.mediaInatividadeSeg)} em média, sem resolver nada.`,
    },
    {
      titulo: 'Resolução automática',
      valor: i.tipoAutomatico,
      cor: CORES.green,
      gravidade: 'positivo',
      texto: `${int(i.tipoAutomatico)} atendimentos (${pct(i.tipoAutomatico / total, 1)}) foram do tipo Automático — resolvidos sem nenhum agente.`,
    },
    {
      titulo: 'Passagem pelo suporte no bot',
      valor: i.passouSuporte,
      cor: CORES.primary,
      gravidade: 'atencao',
      texto: `${int(i.passouSuporte)} clientes passaram por Suporte ou Financeiro no bot antes de encerrar.`,
    },
    {
      titulo: 'Sem tag: lacuna de análise',
      valor: i.semTag,
      cor: CORES.blue,
      gravidade: 'atencao',
      texto: `${int(i.semTag)} atendimentos (${pct(i.semTag / total, 1)}) não receberam tag — sem ela não há como saber o motivo real do contato.`,
    },
    {
      titulo: 'Reincidência',
      valor: i.reincidentes,
      cor: CORES.nativeRed,
      gravidade: 'atencao',
      texto: `${int(i.reincidentes)} contatos são reincidentes ou rechamadas (${pct(i.reincidentes / total, 1)} do período) — problema que não fechou na primeira interação.`,
    },
  ];
}

// ---------------------------------------------------------------------- HSM

export function AnaliticoHsm() {
  const padrao = usePeriodoPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({ de: padrao.de, ate: padrao.ate });
  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = { ...periodo, template: lista('template'), categoria: lista('categoria') };

  // qual motivo de não entrega está aberto; null = nenhum
  const [motivoAberto, setMotivoAberto] = useState(null);

  const opcoes = useAnaliticosFiltros(periodo);
  const consulta = useAnaliticoHsm(filtros);
  // só busca o detalhamento quando alguém abre um motivo
  const falhas = useAnaliticoHsmFalhas({ ...filtros, motivo: motivoAberto }, !!motivoAberto);
  const d = consulta.data;
  const k = d?.kpis || {};

  const refKpis = useRef(null);
  useAlturaNoCromo(refKpis, '--h-kpis');

  return (
    <div className="page rola">
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
          { label: 'Enviadas', value: int(k.enviadas ?? 0), desc: `${k.diasComEnvio ?? 0} dias com envio` },
          { label: 'Entregues', value: int(k.entregues ?? 0), desc: k.taxaEntrega === null || k.taxaEntrega === undefined ? '—' : `${pct(k.taxaEntrega, 1)} das enviadas` },
          {
            label: 'Lidas',
            value: int(k.lidas ?? 0),
            desc: k.taxaLeituraDoEntregue ? `${pct(k.taxaLeituraDoEntregue, 1)} do entregue` : '—',
            title: k.taxaLeitura ? `${pct(k.taxaLeitura, 1)} do total enviado` : undefined,
          },
          { label: 'Não entregues', value: int(k.falhas ?? 0), desc: k.enviadas ? `${pct(k.falhas / k.enviadas, 1)} de falha` : '—' },
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

      {/* ---------------- funil de entrega ---------------- */}
      <Secao
        titulo="Funil de entrega"
        sub="Cada etapa é medida sobre o ENVIADO, que é a base que não muda de degrau para degrau — é o que deixa as etapas comparáveis entre si."
      >
        <div className="grid linha-dupla">
          <Card titulo="Enviadas → Entregues → Lidas" consulta={consulta} vazio={!d?.funil?.length}>
            <Funil etapas={d?.funil} />
          </Card>
          <Card titulo="Distribuição por status da mensagem" sub="Como a plataforma classificou cada disparo" consulta={consulta} vazio={!d?.porStatus?.length}>
            <ListaBarras
              itens={d?.porStatus}
              max={10}
              corDe={(i) => (i.entregou ? CORES.green : CORES.critico)}
            />
          </Card>
        </div>
      </Secao>

      {/* ---------------- desempenho por template ---------------- */}
      <Secao
        titulo="Desempenho por template"
        sub="A taxa de ENTREGA mede o cadastro do número e a política da Meta; a de LEITURA mede o interesse de quem recebeu. Separar as duas é o que distingue template ruim de público ruim."
      >
        <Painel
          titulo="Por template"
          sub="Ordenado por volume enviado"
          className="v-auto"
          consulta={consulta}
          dados={d?.porTemplate}
          ordemInicial={{ key: 'enviadas', dir: 'desc' }}
          colunas={[
            { key: 'chave', titulo: 'Template', align: 'left', largura: 250 },
            { key: 'categoria', titulo: 'Categoria', align: 'left', largura: 96 },
            colBarra('enviadas', 'Enviadas'),
            { key: 'entregues', titulo: 'Entregues', fmt: int },
            {
              key: 'taxaEntrega',
              titulo: '% entrega',
              fmt: (v) => (v === null ? '—' : pct(v, 1)),
              // polaridade: verde bate a régua de 85%, atenção abaixo dela
              corFundo: (r) => (r.taxaEntrega === null ? null : r.taxaEntrega >= 0.85 ? CORES.fundoPositivo : CORES.fundoAtencao),
            },
            { key: 'lidas', titulo: 'Lidas', fmt: int },
            { key: 'taxaLeitura', titulo: '% leitura', fmt: (v) => (v === null ? '—' : pct(v, 1)) },
            { key: 'falhas', titulo: 'Não entregues', fmt: (v) => (v ? int(v) : '—') },
          ]}
        />

        <div className="grid linha-dupla">
          <Painel
            titulo="Evolução por data"
            sub="Volume e taxas de cada dia"
            className="v-auto"
            consulta={consulta}
            dados={d?.porDia}
            colunas={[
              { key: 'label', titulo: 'Data', align: 'left', largura: 74 },
              colBarra('enviadas', 'Enviadas'),
              { key: 'entregues', titulo: 'Entregues', fmt: int },
              { key: 'taxaEntrega', titulo: '% entrega', fmt: (v) => (v === null ? '—' : pct(v, 1)) },
              { key: 'lidas', titulo: 'Lidas', fmt: int },
              { key: 'taxaLeitura', titulo: '% leitura', fmt: (v) => (v === null ? '—' : pct(v, 1)) },
            ]}
          />
          <Card titulo="Por categoria" sub="Como a Meta classifica o template" consulta={consulta} vazio={!d?.porCategoria?.length}>
            <ListaBarras itens={d?.porCategoria} max={8} />
          </Card>
        </div>
      </Secao>

      {/* ---------------- motivos de não entrega ---------------- */}
      <Secao
        titulo="Motivos de não entrega"
        sub="O motivo é o próprio status devolvido pela plataforma. Clique num motivo para ver as mensagens que caíram nele."
      >
        <Card
          titulo="Motivos"
          sub={`${int(k.falhas ?? 0)} mensagens não entregues no período`}
          consulta={consulta}
          vazio={!d?.falhas?.length}
        >
          <div className="an-barras">
            {(d?.falhas || []).map((f) => (
              <div
                key={f.chave}
                className={`an-barra an-clicavel${motivoAberto === f.chave ? ' an-selecionado' : ''}`}
                onClick={() => setMotivoAberto(motivoAberto === f.chave ? null : f.chave)}
              >
                <div className="an-barra-lbl" title={f.chave}>{f.chave}</div>
                <div className="an-barra-trilha">
                  <div
                    className="an-barra-preenche"
                    style={{ width: `${Math.max((f.n / (d.falhas[0]?.n || 1)) * 100, 1.5)}%`, background: CORES.critico }}
                  />
                </div>
                <div className="an-barra-n">{int(f.n)}</div>
                <div className="an-barra-pct">{f.pct === null ? '' : pct(f.pct, 0)}</div>
              </div>
            ))}
          </div>

          {motivoAberto && (
            <>
              <Aviso tom="neutro">
                Mostrando as mensagens mais recentes com o motivo <b>{motivoAberto}</b>
                {falhas.data ? ` — ${int(falhas.data.length)} de ${int((d?.falhas || []).find((f) => f.chave === motivoAberto)?.n ?? 0)}` : ''}
              </Aviso>
              <div className="an-tabela-wrap">
                {falhas.isLoading ? <Loading />
                  : falhas.isError ? <Erro erro={falhas.error} />
                  : !falhas.data?.length ? <Vazio />
                  : (
                    <Tabela
                      dados={falhas.data.map((f, i) => ({ ...f, __key: `${f.protocolo}-${i}` }))}
                      colunas={[
                        { key: 'enviadaEm', titulo: 'Enviada', align: 'left', fmt: (v) => `${dataBr(v)} ${horaBr(v)}` },
                        { key: 'template', titulo: 'Template', align: 'left', largura: 200 },
                        { key: 'contato', titulo: 'Contato', align: 'left', largura: 150 },
                        { key: 'telefone', titulo: 'Telefone', align: 'left' },
                        { key: 'protocolo', titulo: 'Protocolo', align: 'left' },
                      ]}
                    />
                  )}
              </div>
            </>
          )}
        </Card>
      </Secao>
    </div>
  );
}

// ----------------------------------------------------------------------- CX

export function AnaliticoCx() {
  const padrao = usePeriodoPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({ de: padrao.de, ate: padrao.ate });
  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = { ...periodo, fluxo: lista('fluxo'), cidade: lista('cidade') };

  // filtros locais da lista de envios, como na app de origem
  const [busca, setBusca] = useState('');
  const [resultado, setResultado] = useState('');
  const [erroAberto, setErroAberto] = useState(null);

  const opcoes = useAnaliticosFiltros(periodo);
  const consulta = useAnaliticoCx(filtros);
  const cruzado = useAnaliticoCxCruzado(filtros);
  const d = consulta.data;
  const k = d?.kpis || {};
  const cz = cruzado.data;
  const r = cz?.resumo || {};

  const refKpis = useRef(null);
  useAlturaNoCromo(refKpis, '--h-kpis');

  const itensFiltrados = (cz?.itens || []).filter((i) => {
    if (resultado === 'gerado' && !i.gerado) return false;
    if (resultado === 'erro' && i.gerado) return false;
    if (resultado === 'ok' && i.resposta !== 'ok') return false;
    if (resultado === 'nok' && i.resposta !== 'nok') return false;
    if (resultado === 'semresposta' && i.resposta === 'ok') return false;
    if (erroAberto && i.motivoErro !== erroAberto) return false;
    const q = busca.trim().toLowerCase();
    if (q && ![i.cliente, i.telefone, i.protocolo, i.contrato, i.bairro, i.cidade]
      .join(' ').toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="page rola">
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
          { label: 'Disparos', value: int(k.disparos ?? 0), desc: `${k.cidades ?? 0} cidade(s) alcançada(s)` },
          { label: 'Sucesso', value: int(k.sucesso ?? 0), desc: k.taxaSucesso === null || k.taxaSucesso === undefined ? '—' : `${pct(k.taxaSucesso, 1)} dos disparos` },
          { label: 'Avaliações CX', value: int(k.avaliacoes ?? 0), desc: 'Respostas OK + NOK' },
          {
            label: 'CX Score',
            value: k.score === null || k.score === undefined ? '—' : pct(k.score, 1),
            desc: 'Satisfação pós-instalação',
          },
          {
            label: 'Taxa de resposta',
            value: k.taxaResposta === null || k.taxaResposta === undefined ? '—' : pct(k.taxaResposta, 1),
            desc: 'Respostas sobre disparos com sucesso',
          },
        ]}
      />

      <Aviso tom="neutro">
        A pesquisa é medida pelas tags <code>CS_CX_72HRS_OK</code> e <code>CS_CX_72HRS_NOK</code> do
        atendimento — quem responde gera um atendimento marcado no MatrixGO. Por isso o CX Score não
        vem da tabela de disparos, e sim do cruzamento com o analítico de atendimento.
      </Aviso>

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

      {/* ---------------- a pesquisa ---------------- */}
      <Secao
        titulo="Customer Success · CX Score"
        sub="A satisfação de quem respondeu, e como ela se distribui pelos dias do período."
      >
        {k.avaliacoes ? (
          <Proporcao
            titulo="CX Score"
            valor={k.score}
            sub={`${int(k.ok)} OK · ${int(k.nok)} NOK · ${int(k.avaliacoes)} avaliações`}
            cor={k.score >= 0.8 ? CORES.green : k.score >= 0.5 ? CORES.orange : CORES.critico}
            blocos={[
              { chave: 'CX OK', n: k.ok, pct: k.avaliacoes ? k.ok / k.avaliacoes : 0, cor: CORES.green },
              { chave: 'CX NOK', n: k.nok, pct: k.avaliacoes ? k.nok / k.avaliacoes : 0, cor: CORES.critico },
            ]}
          />
        ) : (
          <Aviso>Nenhuma resposta de pesquisa no período — as tags CS_CX_72HRS não apareceram nestes dias.</Aviso>
        )}

        <div className="grid linha-dupla">
          <Card titulo="Respostas por dia" sub="Divisão entre OK e NOK em cada dia" consulta={consulta} vazio={!d?.respostas?.porDia?.length}>
            <BarraOkNok dias={d?.respostas?.porDia} />
          </Card>
          <Card
            titulo="Tags de pós-instalação"
            sub="O funil da pesquisa: quem recebeu, quem respondeu e como"
            consulta={consulta}
            vazio={!d?.tagsCx?.length}
          >
            <ListaBarras
              itens={d?.tagsCx?.map((t) => ({ ...t, pct: k.avaliacoes ? t.n / k.avaliacoes : null }))}
              max={8}
              corDe={(i) => (i.resultado === 'ok' ? CORES.green : i.resultado === 'nok' ? CORES.critico : CORES.blue)}
            />
          </Card>
        </div>
      </Secao>

      {/* ---------------- os disparos ---------------- */}
      <Secao
        titulo="Envios da pesquisa"
        sub="Cada automação do n8n, a cobertura geográfica e o que os erros de disparo dizem."
      >
        <div className="grid linha-dupla">
          <Painel
            titulo="Por fluxo"
            sub="Cada automação do n8n e sua taxa de sucesso"
            className="v-auto"
            consulta={consulta}
            dados={d?.porFluxo}
            ordemInicial={{ key: 'disparos', dir: 'desc' }}
            colunas={[
              { key: 'chave', titulo: 'Fluxo', align: 'left', largura: 250 },
              colBarra('disparos', 'Disparos'),
              { key: 'sucesso', titulo: 'Sucesso', fmt: int },
              { key: 'taxa', titulo: '% sucesso', fmt: (v) => (v === null ? '—' : pct(v, 1)) },
            ]}
          />
          <Painel
            titulo="Cobertura por cidade"
            className="v-auto"
            consulta={consulta}
            dados={d?.porCidade}
            ordemInicial={{ key: 'disparos', dir: 'desc' }}
            colunas={[
              { key: 'chave', titulo: 'Cidade', align: 'left', largura: 170 },
              colBarra('disparos', 'Disparos'),
              { key: 'sucesso', titulo: 'Sucesso', fmt: int },
              { key: 'taxa', titulo: '% sucesso', fmt: (v) => (v === null ? '—' : pct(v, 1)) },
            ]}
          />
        </div>

        <Painel
          titulo="Bairros com mais envios"
          sub="Os 25 maiores; o Billing_Collection não traz cidade nem bairro, e cai em '(sem bairro)'"
          className="v-auto"
          consulta={consulta}
          dados={d?.porBairro}
          ordemInicial={{ key: 'disparos', dir: 'desc' }}
          colunas={[
            { key: 'chave', titulo: 'Bairro · Cidade', align: 'left', largura: 280 },
            colBarra('disparos', 'Disparos'),
            { key: 'sucesso', titulo: 'Sucesso', fmt: int },
            { key: 'taxa', titulo: '% sucesso', fmt: (v) => (v === null ? '—' : pct(v, 1)) },
          ]}
        />
      </Secao>

      {/* ---------------- cruzamento ---------------- */}
      <Secao
        titulo="Disparo → atendimento → resposta"
        sub="Cada disparo é ligado ao atendimento que ele gerou (por protocolo e, quando falha, por telefone) e à resposta da pesquisa. É o que permite dizer quantos dos que receberam realmente responderam."
      >
        {cruzado.isLoading ? <Loading texto="Cruzando disparos com atendimentos…" />
          : cruzado.isError ? <Erro erro={cruzado.error} />
          : !cz ? <Vazio />
          : (
            <>
              <FaixaKpis
                itens={[
                  { label: 'Envios', value: int(r.disparos ?? 0), desc: `${int(r.gerados ?? 0)} geraram atendimento` },
                  { label: 'Erros no disparo', value: int(r.erros ?? 0), desc: r.disparos ? `${pct(r.erros / r.disparos, 1)} dos envios` : '—' },
                  { label: 'Localizados', value: int(r.localizados ?? 0), desc: `${int(r.porProtocolo ?? 0)} por protocolo · ${int(r.porTelefone ?? 0)} por telefone` },
                  { label: 'Responderam', value: int(r.respostas ?? 0), desc: `${int(r.ok ?? 0)} OK · ${int(r.nok ?? 0)} NOK` },
                  {
                    label: 'Score do disparo',
                    value: r.score === null || r.score === undefined ? '—' : pct(r.score, 1),
                    desc: 'Entre quem respondeu',
                  },
                ]}
              />

              {!!r.aguardandoJanela && (
                <Aviso>
                  <b>{int(r.aguardandoJanela)}</b> disparos são recentes e ainda estão dentro da janela de 72 h da
                  pesquisa — eles ficam fora da base da taxa de resposta, senão o período mais novo pareceria
                  sempre pior só por ser novo.
                </Aviso>
              )}

              {!!cz.erros?.length && (
                <Card titulo="Erros do disparo" sub="Agrupados pelo código de retorno; clique para filtrar a lista abaixo">
                  <div className="an-barras">
                    {cz.erros.map((e) => (
                      <div
                        key={e.chave}
                        className={`an-barra an-clicavel${erroAberto === e.chave ? ' an-selecionado' : ''}`}
                        onClick={() => setErroAberto(erroAberto === e.chave ? null : e.chave)}
                      >
                        <div className="an-barra-lbl" title={e.chave}>
                          {e.codigos.map((c) => <code key={c} style={{ marginRight: 5 }}>{c}</code>)}
                          {e.chave}
                        </div>
                        <div className="an-barra-trilha">
                          <div
                            className="an-barra-preenche"
                            style={{ width: `${Math.max((e.n / (cz.erros[0]?.n || 1)) * 100, 1.5)}%`, background: CORES.critico }}
                          />
                        </div>
                        <div className="an-barra-n">{int(e.n)}</div>
                        <div className="an-barra-pct">{r.erros ? pct(e.n / r.erros, 0) : ''}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <Card
                titulo="Sequência dos envios"
                sub={r.truncado
                  ? `Mostrando ${int(r.mostrando)} dos ${int(r.disparos)} envios do período — os indicadores acima consideram todos`
                  : `${int(r.disparos)} envios no período`}
              >
                <div className="an-filtros-card">
                  <input
                    type="text"
                    placeholder="Buscar cliente, telefone, protocolo, contrato ou bairro…"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                  <select value={resultado} onChange={(e) => setResultado(e.target.value)}>
                    <option value="">Todos os resultados</option>
                    <option value="gerado">Atendimento gerado</option>
                    <option value="erro">Não gerado (erro)</option>
                    <option value="ok">Respondeu OK</option>
                    <option value="nok">Respondeu NOK</option>
                    <option value="semresposta">Sem resposta</option>
                  </select>
                  {(busca || resultado || erroAberto) && (
                    <button
                      type="button"
                      className="an-mais"
                      onClick={() => { setBusca(''); setResultado(''); setErroAberto(null); }}
                    >
                      limpar
                    </button>
                  )}
                  <span className="an-conta">{int(itensFiltrados.length)} linha(s)</span>
                </div>

                <div className="an-tabela-wrap">
                  {!itensFiltrados.length ? <Vazio texto="Nenhum envio para estes filtros" /> : (
                    <Tabela
                      dados={itensFiltrados.map((i, idx) => ({ ...i, __key: `${i.protocolo}-${idx}` }))}
                      colunas={[
                        { key: 'disparadoEm', titulo: 'Disparo', align: 'left', fmt: (v) => `${dataBr(v)} ${horaBr(v)}` },
                        { key: 'protocolo', titulo: 'Protocolo', align: 'left', fmt: (v) => v || '—' },
                        { key: 'cliente', titulo: 'Cliente', align: 'left', largura: 165 },
                        { key: 'cidade', titulo: 'Cidade', align: 'left', largura: 110 },
                        {
                          key: 'gerado',
                          titulo: 'Disparo',
                          align: 'center',
                          fmt: (v) => (v ? 'gerado' : 'erro'),
                          corFundo: (x) => (x.gerado ? CORES.fundoPositivo : CORES.fundoAtencao),
                        },
                        {
                          key: 'resposta',
                          titulo: 'Resposta CX',
                          align: 'center',
                          fmt: (v) => ROTULO_RESPOSTA[v] || v,
                          corFundo: (x) => (x.resposta === 'ok' ? CORES.fundoPositivo
                            : x.resposta === 'nok' ? CORES.fundoAtencao : null),
                        },
                        { key: 'via', titulo: 'Casou por', align: 'left', fmt: (v) => v || '—' },
                      ]}
                    />
                  )}
                </div>
              </Card>
            </>
          )}
      </Secao>
    </div>
  );
}

const ROTULO_RESPOSTA = {
  ok: 'OK',
  nok: 'NOK',
  semresposta: 'sem resposta',
  naoachado: 'não localizado',
};
