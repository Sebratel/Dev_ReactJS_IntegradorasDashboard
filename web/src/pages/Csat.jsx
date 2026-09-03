import { useLayoutEffect, useRef } from 'react';
import { useCsatCobertura, useCsatDetalhado, useCsatFiltros, useCsatSerie } from '../api';
import { CORES, ComboChart } from '../components/charts';
import { Filtro, FiltroPeriodo, periodoPadrao, useFiltros } from '../components/SlicerBar';
import { Tabela } from '../components/tables';
import { Icone } from '../components/Icone';
import { Erro, Legenda, Loading, Segmentado, Vazio, Visual } from '../components/ui';
import { dataBr, horaBr, int, pct } from '../format';

/**
 * As duas telas de CSAT (páginas `ef550f...` e `745e3f...`) têm a mesma forma:
 * combo com volume + respostas nas colunas e nota + adesão nas linhas, e uma
 * tabela larga com as respostas.
 *
 * Três séries dos combos da origem apontam para medidas que não existem mais no
 * modelo (`#finalizadas`, `#nota_csat1`, `#adesao1`), então não desenham no
 * relatório publicado. Aqui apontam para as medidas equivalentes que existem —
 * ver o comentário em `server/src/model/csat.js`.
 */

/** A resposta vem como "Satisfeito ##1f60a##": o sufixo é o emoji codificado. */
const semEmoji = (v) => String(v ?? '').replace(/\s*##[0-9a-f]+##\s*/gi, '').trim() || '—';

function TabelaRespostas({ consulta }) {
  if (consulta.isLoading) return <Loading />;
  if (consulta.isError) return <Erro erro={consulta.error} />;
  if (!consulta.data?.length) return <Vazio texto="Nenhuma resposta de pesquisa no período" />;
  return (
    <Tabela
      dados={consulta.data}
      colunas={[
        { key: 'dat_resposta', titulo: 'Resposta', align: 'left', fmt: (v) => `${dataBr(v)} ${horaBr(v)}` },
        { key: 'nom_agente', titulo: 'Agente', align: 'left', largura: 180 },
        { key: 'nom_pergunta', titulo: 'Pergunta', align: 'left', largura: 300 },
        { key: 'nom_resposta', titulo: 'Resposta', align: 'left', fmt: semEmoji },
        { key: 'nom_valor', titulo: 'Nota', align: 'center' },
        { key: 'nom_conta', titulo: 'Conta', align: 'left' },
        { key: 'nom_tipo_integracao', titulo: 'Canal', align: 'left' },
        { key: 'num_protocolo', titulo: 'Protocolo', align: 'left' },
      ]}
    />
  );
}

/**
 * Aviso de base parada. Recorte invisível gera chamado: sem isto, quem abre a tela
 * do CSAT Native vê tudo vazio e conclui que o dashboard está quebrado. As datas
 * vêm do dado — se a coleta voltar, o aviso some sozinho.
 *
 * Ele mede a própria altura e a devolve para `--h-aviso`, de onde sai `--util`: o
 * texto quebra em mais linhas em tela estreita, então altura fixa no CSS deixava
 * 24px de rolagem em 1366x768. Medir é a única forma de a conta fechar em todas.
 */
function AvisoCobertura({ cobertura, de, ate }) {
  const ref = useRef(null);
  const mostrar = Boolean(cobertura?.ate) && cobertura.ate.slice(0, 10) < de;

  useLayoutEffect(() => {
    const raiz = document.documentElement;
    if (!mostrar) {
      raiz.style.removeProperty('--h-aviso');
      return undefined;
    }
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      const meu = getComputedStyle(el);
      // a .page é flex-column com gap: o aviso come a própria altura, a margem E o
      // gap que o separa do visual seguinte — faltava o gap, e sobravam 9px
      const gap = parseFloat(getComputedStyle(el.parentElement).rowGap) || 0;
      const margem = parseFloat(meu.marginBottom) || 0;
      raiz.style.setProperty('--h-aviso', `${Math.ceil(el.getBoundingClientRect().height + margem + gap)}px`);
    };
    medir();
    window.addEventListener('resize', medir);
    return () => {
      window.removeEventListener('resize', medir);
      raiz.style.removeProperty('--h-aviso');
    };
  }, [mostrar, cobertura?.ate]);

  if (!mostrar) return null;
  return (
    <div className="aviso-recorte" ref={ref}>
      <Icone nome="alerta" tamanho={15} />
      <span>
        A base de avaliações tem <b>{int(cobertura.registros)}</b> registros e o mais recente é de{' '}
        <b>{dataBr(cobertura.ate)}</b> — nada foi coletado depois disso. O período selecionado
        ({dataBr(`${de}T00:00:00`)} a {dataBr(`${ate}T00:00:00`)}) fica fora dessa janela, então os
        indicadores de pesquisa aparecem vazios.
      </span>
    </div>
  );
}

function PaginaCsat({ qual, titulo, subtitulo, colunas, linhas, filtrosDaTela }) {
  const padrao = periodoPadrao();
  const { valores, definir, limpar, lista, temFiltro } = useFiltros({
    de: padrao.de, ate: padrao.ate, granularidade: 'dia',
  });

  const periodo = { de: valores.de, ate: valores.ate };
  const filtros = { ...periodo, granularidade: valores.granularidade };
  for (const f of filtrosDaTela) filtros[f.chave] = lista(f.chave);

  const opcoes = useCsatFiltros(qual, periodo);
  const serie = useCsatSerie(qual, filtros);
  const detalhado = useCsatDetalhado(qual, filtros);
  const cobertura = useCsatCobertura(qual);

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

      <AvisoCobertura cobertura={cobertura.data} de={valores.de} ate={valores.ate} />

      <Visual
        className="v-grafico"
        title={titulo}
        sub={subtitulo}
        actions={
          <Segmentado
            valor={valores.granularidade}
            opcoes={[{ id: 'dia', label: 'dia' }, { id: 'mes', label: 'mês' }]}
            onChange={(g) => definir('granularidade', g)}
            titulo="Granularidade do eixo"
          />
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

      <Visual className="v-tabela" title="Relatório detalhado" sub="Respostas da pesquisa de satisfação no período" flush>
        <TabelaRespostas consulta={detalhado} />
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
      ]}
    />
  );
}

export function CsatNative() {
  return (
    <PaginaCsat
      qual="csat-native"
      titulo="CSAT Native"
      subtitulo="Principais perguntas da pesquisa de satisfação do Native Infinity"
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
        { chave: 'resposta', nome: 'CSAT' },
      ]}
    />
  );
}
