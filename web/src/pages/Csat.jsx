import { useRef } from 'react';
import { useCsatCobertura, useCsatDetalhado, useCsatFiltros, useCsatSerie } from '../api';
import { CORES, ComboChart } from '../components/charts';
import { Filtro, FiltroPeriodo, FiltroTexto, useInicioGeral, usePeriodoPadrao, useFiltros } from '../components/SlicerBar';
import { TabelaDetalhada, useLegendaDetalhado } from '../components/detalhado';
import { Icone } from '../components/Icone';
import { useAlturaNoCromo } from '../components/cromo';
import { Erro, Legenda, Loading, Segmentado, Vazio, Visual } from '../components/ui';
import { BotaoInsights } from '../components/InsightsIA';
import { dataBr, horaBr, int, pct } from '../format';

/**
 * As duas telas de CSAT (páginas `ef550f...` e `745e3f...`) têm a mesma forma:
 * combo com volume + respostas nas colunas e nota + adesão nas linhas, e uma
 * tabela larga com as respostas.
 *
 * As séries usam as mesmas medidas do Power BI (FINALIZADOS/ATENDIDAS, RESPOSTAS,
 * NOTA e ADESÃO) — ver o comentário em `server/src/model/csat.js` (D-12).
 *
 * Slicers (D-08): CSAT MATRIX ganha AGENTE e PROTOCOLO, que filtram os dois lados da
 * conta (finalizados e avaliações, B15); CSAT NATIVE ganha PROTOCOLO.
 */

/** A resposta vem como "Satisfeito ##1f60a##": o sufixo é o emoji codificado. */
const semEmoji = (v) => String(v ?? '').replace(/\s*##[0-9a-f]+##\s*/gi, '').trim() || '—';

const quando = { key: 'dat_resposta', titulo: 'Resposta', align: 'left', fmt: (v) => `${dataBr(v)} ${horaBr(v)}` };

const COLUNAS_MATRIX = [
  quando,
  { key: 'nom_agente', titulo: 'Agente', align: 'left', largura: 180 },
  { key: 'nom_pergunta', titulo: 'Pergunta', align: 'left', largura: 300 },
  { key: 'nom_resposta', titulo: 'Resposta', align: 'left', fmt: semEmoji },
  { key: 'nom_valor', titulo: 'Nota', align: 'center' },
  { key: 'nom_conta', titulo: 'Conta', align: 'left' },
  { key: 'nom_tipo_integracao', titulo: 'Canal', align: 'left' },
  { key: 'num_protocolo', titulo: 'Protocolo', align: 'left' },
];

/**
 * A pesquisa da URA não tem texto de resposta nem conta: tem a nota e a perna da
 * ligação. Numa transferência a mesma nota aparece uma vez por ramal, e é assim
 * que a tabela mostra — cada agente que atendeu a ligação vê a nota dela.
 */
const COLUNAS_NATIVE = [
  { ...quando, titulo: 'Ligação' },
  { key: 'nom_agente', titulo: 'Agente', align: 'left', largura: 200 },
  { key: 'fila', titulo: 'Fila', align: 'left', largura: 220 },
  { key: 'sentido', titulo: 'Sentido', align: 'left' },
  { key: 'nom_pergunta', titulo: 'Pergunta', align: 'left' },
  { key: 'nom_valor', titulo: 'Nota', align: 'center' },
  { key: 'desconexao', titulo: 'Desconexão', align: 'left' },
  { key: 'ramal', titulo: 'Ramal', align: 'left' },
  { key: 'num_protocolo', titulo: 'Protocolo', align: 'left' },
];

/**
 * Aviso de período fora da coleta. Recorte invisível gera chamado: sem isto, quem
 * abre a tela vê tudo vazio e conclui que o dashboard está quebrado. Cobre os dois
 * lados — período depois da última coleta e período que começa antes do início da
 * pesquisa (a da URA do Native começou em 01/09/2026). As datas vêm do dado, então
 * o aviso some sozinho quando deixa de valer.
 *
 * Ele mede a própria altura e a devolve para `--h-aviso`, de onde sai `--util`: o
 * texto quebra em mais linhas em tela estreita, então altura fixa no CSS deixava
 * 24px de rolagem em 1366x768. Medir é a única forma de a conta fechar em todas.
 */
function AvisoCobertura({ cobertura, de, ate }) {
  const ref = useRef(null);
  const primeira = cobertura?.de?.slice(0, 10);
  const ultima = cobertura?.ate?.slice(0, 10);
  const depoisDaColeta = Boolean(ultima) && ultima < de;
  const antesDaPesquisa = !depoisDaColeta && Boolean(primeira) && de < primeira;
  const mostrar = depoisDaColeta || antesDaPesquisa;
  useAlturaNoCromo(ref, '--h-aviso', mostrar);

  if (!mostrar) return null;
  const periodo = `${dataBr(`${de}T00:00:00`)} a ${dataBr(`${ate}T00:00:00`)}`;
  return (
    <div className="aviso-recorte" ref={ref}>
      <Icone nome="alerta" tamanho={15} />
      {depoisDaColeta ? (
        <span>
          A base de avaliações tem <b>{int(cobertura.registros)}</b> registros e o mais recente é de{' '}
          <b>{dataBr(cobertura.ate)}</b> — nada foi coletado depois disso. O período selecionado
          ({periodo}) fica fora dessa janela, então os indicadores de pesquisa aparecem vazios.
        </span>
      ) : (
        <span>
          A pesquisa começou em <b>{dataBr(cobertura.de)}</b>. O período selecionado ({periodo})
          começa antes disso: nesses dias não há avaliação, então nota e adesão ficam vazias — não
          é queda de satisfação.
        </span>
      )}
    </div>
  );
}

function PaginaCsat({ qual, titulo, subtitulo, colunas, linhas, filtrosDaTela, colunasTabela }) {
  const padrao = usePeriodoPadrao({ geral: true });
  const inicio = useInicioGeral();
  const { valores, definir, definirVarios, limpar, lista, temFiltro } = useFiltros({
    de: padrao.de, ate: padrao.ate, granularidade: 'dia',
  });

  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = { ...periodo, granularidade: valores.granularidade };
  for (const f of filtrosDaTela) filtros[f.chave] = lista(f.chave);

  const opcoes = useCsatFiltros(qual, periodo);
  const serie = useCsatSerie(qual, filtros);
  const detalhado = useCsatDetalhado(qual, filtros);
  const cobertura = useCsatCobertura(qual);
  const legenda = useLegendaDetalhado(`/${qual}/detalhado`, filtros, detalhado.data?.length || 0, 'respostas');

  return (
    <div className="page">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo de={valores.de} ate={valores.ate} min={inicio} onChange={(de, ate) => { definirVarios({ de, ate }); }} />
        {filtrosDaTela.map((f) => (f.texto ? (
          <FiltroTexto
            key={f.chave}
            nome={f.nome}
            valores={lista(f.chave)}
            onChange={(v) => definir(f.chave, v)}
          />
        ) : (
          <Filtro
            key={f.chave}
            nome={f.nome}
            opcoes={opcoes.data?.[f.chave] || []}
            marcados={lista(f.chave)}
            onChange={(v) => definir(f.chave, v)}
          />
        )))}
        {temFiltro && <button type="button" className="limpar" onClick={limpar}>Limpar filtros</button>}
      </div>

      <AvisoCobertura cobertura={cobertura.data} de={valores.de} ate={valores.ate} />

      <Visual
        className="v-grafico"
        title={titulo}
        sub={subtitulo}
        actions={
          <>
            <Segmentado
              valor={valores.granularidade}
              opcoes={[{ id: 'dia', label: 'dia' }, { id: 'mes', label: 'mês' }]}
              onChange={(g) => definir('granularidade', g)}
              titulo="Granularidade do eixo"
            />
            {/* `qual` já é 'csat-matrix' ou 'csat-native': o id do visual no
                catálogo do servidor é o mesmo com o prefixo do relatório */}
            <BotaoInsights visual={`geral-${qual}:serie`} titulo={titulo} filtros={filtros} />
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
                  ...colunas.map((c) => ({ label: c.nome, cor: c.cor })),
                  ...linhas.map((l) => ({ label: l.nome, cor: l.cor, linha: true })),
                ]}
              />
              <ComboChart
                data={serie.data}
                barras={colunas}
                linhas={linhas.map((l) => ({ ...l, fmt: (v) => pct(v, 1) }))}
                escalaSecundaria
              />
            </>
          )}
      </Visual>

      <Visual className="v-tabela" title="Relatório detalhado" sub={`Respostas da pesquisa de satisfação · ${legenda}`} flush>
        <TabelaDetalhada
          caminho={`/${qual}/detalhado`}
          filtros={filtros}
          consulta={detalhado}
          colunas={colunasTabela}
          vazio="Nenhuma resposta de pesquisa no período"
        />
      </Visual>
    </div>
  );
}

export function CsatMatrix() {
  return (
    <PaginaCsat
      qual="csat-matrix"
      titulo="CSAT Matrix"
      subtitulo="Principais perguntas da pesquisa de satisfação do MatrixGO"
      colunas={[
        { key: 'finalizados', nome: 'Finalizados', cor: CORES.gold },
        { key: 'respostas', nome: 'Respostas CSAT', cor: CORES.primary },
      ]}
      linhas={[
        { key: 'nota', nome: 'Nota CSAT', cor: CORES.ink },
        { key: 'adesao', nome: 'Adesão', cor: CORES.blue },
      ]}
      filtrosDaTela={[
        { chave: 'ativoReceptivo', nome: 'Ativo/Receptivo' },
        { chave: 'servico', nome: 'Fila' },
        { chave: 'pergunta', nome: 'CSAT' },
        { chave: 'agente', nome: 'Agente' },
        { chave: 'protocolo', nome: 'Protocolo', texto: true },
      ]}
      colunasTabela={COLUNAS_MATRIX}
    />
  );
}

export function CsatNative() {
  return (
    <PaginaCsat
      qual="csat-native"
      titulo="CSAT Native"
      subtitulo="Pesquisa da URA ao fim da ligação (nota de 1 a 5) — mesma régua de nota e adesão do Matrix"
      colunas={[
        { key: 'atendidas', nome: 'Atendidas', cor: CORES.gold },
        { key: 'respostas', nome: 'Respostas CSAT', cor: CORES.primary },
      ]}
      linhas={[
        { key: 'nota', nome: 'Nota CSAT', cor: CORES.ink },
        { key: 'adesao', nome: 'Adesão', cor: CORES.blue },
      ]}
      filtrosDaTela={[
        { chave: 'sentido', nome: 'Sentido' },
        { chave: 'fila', nome: 'Fila' },
        { chave: 'nota', nome: 'Nota' },
        { chave: 'protocolo', nome: 'Protocolo', texto: true },
      ]}
      colunasTabela={COLUNAS_NATIVE}
    />
  );
}
