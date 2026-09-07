import { useRef } from 'react';
import { useSupDetalhamento, useSupFiltros, useSupResumo } from '../api';
import { CORES } from '../components/charts';
import { useAlturaNoCromo } from '../components/cromo';
import { Filtro, FiltroPeriodo, usePeriodoPadrao, useFiltros } from '../components/SlicerBar';
import { Tabela } from '../components/tables';
import { Erro, Kpi, Loading, Vazio, Visual } from '../components/ui';
import { BotaoInsights } from '../components/InsightsIA';
import { dataBr, horaBr, hmsSeg, int } from '../format';

/**
 * As telas MATRIX e NATIVE do relatório SUP (páginas `dbbeddb0...` e `efdf8a37...`).
 * As duas mostram a mesma coisa em recortes diferentes — por data, por agente e o
 * detalhamento — então dividem este componente.
 *
 * Na origem cada uma tem cinco visuais num canvas bem mais alto que a tela (a
 * pivot de acompanhamento diário do Matrix começa em y=3000). Aqui são a faixa de
 * indicadores no topo e duas faixas de conteúdo, que é o teto de uma tela.
 *
 * TMA/TME seguem a régua do resto do dashboard: mediana no Matrix (onde
 * `data_finalizacao` é quando alguém fecha a conversa, com cauda de dias) e média
 * no Native (durações de ligação, que terminam sozinhas).
 */
function PaginaPlataforma({ qual, titulo, rotuloTme, filtrosDaTela, colunasDetalhe }) {
  const padrao = usePeriodoPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({ de: padrao.de, ate: padrao.ate });

  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = { ...periodo };
  for (const f of filtrosDaTela) filtros[f.chave] = lista(f.chave);

  const opcoes = useSupFiltros(periodo);
  const resumo = useSupResumo(qual, filtros);
  const detalhe = useSupDetalhamento(qual, filtros);

  const refKpis = useRef(null);
  useAlturaNoCromo(refKpis, '--h-kpis');

  const total = resumo.data?.total || {};
  const colunasResumo = (rotuloChave) => [
    { key: 'chave', titulo: rotuloChave, align: 'left', largura: rotuloChave === 'Data' ? 110 : 220,
      fmt: rotuloChave === 'Data' ? (v) => dataBr(`${v}T00:00:00`) : undefined },
    { key: 'qtd', titulo: 'Qtd', fmt: int, databar: { cor: CORES.gold600 } },
    { key: 'tmaSeg', titulo: 'TMA', fmt: hmsSeg },
    { key: 'tmeSeg', titulo: rotuloTme, fmt: hmsSeg },
  ];

  const painel = (tituloVisual, dados, rotuloChave, sub, acoes = null) => (
    <Visual className="v-tabela" title={tituloVisual} sub={sub} actions={acoes} flush>
      {resumo.isLoading ? <Loading />
        : resumo.isError ? <Erro erro={resumo.error} />
        : !dados?.length ? <Vazio />
        : <Tabela dados={dados.map((d, i) => ({ ...d, __key: `${d.chave}-${i}` }))} colunas={colunasResumo(rotuloChave)} />}
    </Visual>
  );

  const temCanal = Boolean(resumo.data?.porCanal?.length);

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo de={valores.de} ate={valores.ate} onChange={(de, ate) => { definir('de', de); definir('ate', ate); }} />
        {filtrosDaTela.map((f) => (
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

      <div className="kpi-faixa" ref={refKpis}>
        <Kpi value={int(total.qtd ?? 0)} label="Atendimentos" desc={`Total no período em ${titulo}`} />
        <Kpi value={hmsSeg(total.tmaSeg)} label="TMA" desc={qual === 'matrix' ? 'Mediana do tempo até a finalização' : 'Média da duração do atendimento'} />
        <Kpi value={hmsSeg(total.tmeSeg)} label={rotuloTme} desc={qual === 'matrix' ? 'Mediana do tempo até a 1ª mensagem do agente' : 'Média do tempo de espera na fila'} />
      </div>

      <div className={`grid ${temCanal ? 'linha-tres' : 'linha-dupla'}`}>
        {/*
          O botão de IA fica só no resumo POR DATA. O de "por agente" não tem, e
          isso é deliberado: o catálogo do servidor descarta o bloco `porAgente`
          antes de montar o prompt, então um botão ali prometeria uma leitura do
          que ele não envia. Ver `server/src/ia/visuais.js`.
        */}
        {painel(
          'Resumo por data', resumo.data?.porData, 'Data', 'Um dia por linha',
          <BotaoInsights visual={`sup-${qual}:resumo`} titulo={`Resumo ${titulo} (Suporte)`} filtros={filtros} />,
        )}
        {painel('Resumo por agente', resumo.data?.porAgente, 'Agente', 'Ordenado por volume')}
        {temCanal && painel('Por canal', resumo.data?.porCanal, 'Canal', 'De onde vem o atendimento')}
      </div>

      <Visual
        className="v-tabela"
        title="Detalhamento de protocolos"
        sub={`Amostra dos ${int(detalhe.data?.length || 0)} atendimentos mais recentes do recorte`}
        flush
      >
        {detalhe.isLoading ? <Loading />
          : detalhe.isError ? <Erro erro={detalhe.error} />
          : !detalhe.data?.length ? <Vazio />
          : <Tabela dados={detalhe.data} colunas={colunasDetalhe} />}
      </Visual>
    </div>
  );
}

export function SupMatrix() {
  return (
    <PaginaPlataforma
      qual="matrix"
      titulo="MatrixGO"
      rotuloTme="TME 1ª msg"
      filtrosDaTela={[
        { chave: 'servico', nome: 'Serviço' },
        { chave: 'ativoReceptivo', nome: 'Ativo/Receptivo' },
        { chave: 'status', nome: 'Status' },
      ]}
      colunasDetalhe={[
        { key: 'atendente', titulo: 'Agente', align: 'left', largura: 190 },
        { key: 'data_atendimento', titulo: 'Atendimento', align: 'left', fmt: (v) => `${dataBr(v)} ${horaBr(v)}` },
        { key: 'protocolo', titulo: 'Protocolo', align: 'left' },
        { key: 'canal', titulo: 'Canal', align: 'left' },
        { key: 'servico', titulo: 'Serviço', align: 'left' },
        { key: 'ativo_receptivo', titulo: 'Ativo/Rec.', align: 'left' },
        {
          key: 'status',
          titulo: 'Status',
          align: 'left',
          corFundo: (d) => (d.status === 'Transferido' ? CORES.fundoAtencao : d.status === 'Finalizado' ? CORES.fundoPositivo : null),
        },
        { key: 'tme_seg', titulo: 'TME 1ª msg', fmt: hmsSeg },
        { key: 'tma_seg', titulo: 'TMA', fmt: hmsSeg },
      ]}
    />
  );
}

export function SupNative() {
  return (
    <PaginaPlataforma
      qual="native"
      titulo="Native Infinity"
      rotuloTme="TME"
      filtrosDaTela={[
        { chave: 'fila', nome: 'Fila' },
        { chave: 'sentido', nome: 'Sentido' },
      ]}
      colunasDetalhe={[
        { key: 'agente', titulo: 'Agente', align: 'left', largura: 190 },
        { key: 'data_hora', titulo: 'Atendimento', align: 'left', fmt: (v) => `${dataBr(v)} ${horaBr(v)}` },
        { key: 'protocolo', titulo: 'Protocolo', align: 'left' },
        { key: 'fila', titulo: 'Fila', align: 'left' },
        { key: 'sentido', titulo: 'Sentido', align: 'left' },
        { key: 'desconexao', titulo: 'Desconexão', align: 'left', fmt: (v) => v || '—' },
        { key: 'nome_cliente', titulo: 'Cliente', align: 'left' },
        { key: 'tme_seg', titulo: 'TME', fmt: hmsSeg },
        { key: 'tma_seg', titulo: 'TMA', fmt: hmsSeg },
      ]}
    />
  );
}
