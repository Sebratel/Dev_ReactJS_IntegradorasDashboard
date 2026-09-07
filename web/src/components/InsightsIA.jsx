/**
 * Leitura de IA de um gráfico específico.
 *
 * O botão fica no cabeçalho do visual e manda apenas o ID do visual e os filtros
 * da tela — nunca os dados. Quem remonta os números é o servidor, pela mesma
 * função que desenha o gráfico, então a leitura não tem como divergir do que está
 * na tela nem ser induzida por uma requisição adulterada.
 */
import { useEffect, useMemo, useState } from 'react';
import { apiFetch, buildQuery, useMeta } from '../api';
import { useSession } from '../auth/session.jsx';
import { Icone } from './Icone';

const GRAVIDADE = {
  critico: { rotulo: 'crítico', icone: 'alerta' },
  atencao: { rotulo: 'atenção', icone: 'alerta' },
  positivo: { rotulo: 'positivo', icone: 'ok' },
};

const dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : null);

function Painel({ visual, titulo, busca, aberto, fechar }) {
  const { ehAdmin } = useSession();
  const [estado, setEstado] = useState({ fase: 'inicio' });

  // cada abertura é uma leitura nova: os filtros podem ter mudado desde a última
  useEffect(() => {
    if (!aberto) return undefined;
    const ctrl = new AbortController();
    setEstado({ fase: 'carregando' });

    (async () => {
      try {
        const res = await apiFetch(
          `/api/geral/insights/visual/${encodeURIComponent(visual)}${busca ? `?${busca}` : ''}`,
          { method: 'POST', signal: ctrl.signal },
        );
        const dados = await res.json().catch(() => null);
        if (ctrl.signal.aborted) return;
        if (!res.ok) {
          setEstado({ fase: 'erro', status: res.status, msg: dados?.error || `Erro ${res.status}` });
          return;
        }
        setEstado({ fase: 'pronto', dados });
      } catch (err) {
        if (!ctrl.signal.aborted) setEstado({ fase: 'erro', msg: err.message });
      }
    })();

    return () => ctrl.abort();
  }, [aberto, visual, busca]);

  // Esc fecha
  useEffect(() => {
    if (!aberto) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') fechar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto, fechar]);

  if (!aberto) return null;

  const { dados } = estado;
  const params = new URLSearchParams(busca);
  const de = dataBr(params.get('de'));
  const ate = dataBr(params.get('ate'));
  const periodo = de || ate ? `${de || 'início'} a ${ate || 'hoje'}` : 'período padrão da tela';

  return (
    <>
      <div className="ia-fundo" onClick={fechar} role="presentation" />
      <aside className="ia-painel" role="dialog" aria-label={`Leitura de IA: ${titulo}`}>
        <header>
          <div>
            <span className="ia-painel-rotulo">Leitura de IA</span>
            <h3>{titulo}</h3>
            <span className="ia-painel-sub">{periodo}</span>
          </div>
          <button type="button" className="ia-fechar" onClick={fechar} title="Fechar (Esc)">
            <Icone nome="fechar" tamanho={15} />
          </button>
        </header>

        <div className="ia-painel-corpo">
          {estado.fase === 'carregando' && (
            <div className="ia-carregando">
              <div className="spinner" />
              <span>Lendo os números deste gráfico…</span>
            </div>
          )}

          {estado.fase === 'erro' && (
            <div className="ia-erro">
              <Icone nome={estado.status === 503 ? 'ia' : 'alerta'} tamanho={15} />
              <div>
                <p>{estado.msg}</p>
                {estado.status === 503 && ehAdmin && (
                  <p className="ia-dica">
                    Cadastre a chave em <b>Configurações → Provedor de IA</b>.
                  </p>
                )}
              </div>
            </div>
          )}

          {estado.fase === 'pronto' && dados && (
            <>
              {dados.resumo && <p className="ia-resumo">{dados.resumo}</p>}

              {(dados.insights || []).map((i, idx) => {
                const g = GRAVIDADE[i.gravidade] || GRAVIDADE.atencao;
                return (
                  <article key={`${i.titulo}-${idx}`} className={`ia-card ${i.gravidade || 'atencao'}`}>
                    <header>
                      <Icone nome={g.icone} tamanho={13} />
                      <h4>{i.titulo}</h4>
                      <span className="ia-selo">{g.rotulo}</span>
                    </header>
                    <p>{i.detalhe}</p>
                    {i.acao && <p className="ia-acao"><b>Ação:</b> {i.acao}</p>}
                    {!!(i.indicadores || []).length && (
                      <ul className="ia-indicadores">
                        {i.indicadores.map((n) => <li key={n}>{n}</li>)}
                      </ul>
                    )}
                  </article>
                );
              })}

              {!!(dados.perguntas || []).length && (
                <div className="ia-perguntas">
                  <h4>O gráfico não responde</h4>
                  <ul>{dados.perguntas.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}

              {dados.formatoInesperado && (
                <p className="ia-dica">
                  O modelo respondeu fora do formato esperado; acima está o texto como veio.
                </p>
              )}

              <footer className="ia-assinatura">
                Interpretação gerada por {dados.provedor} · {dados.modelo}. Os números são
                calculados pelo dashboard — a IA apenas os lê. Nenhum dado individual de agente
                é enviado ao provedor.
              </footer>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

/**
 * Botão para o cabeçalho de um visual.
 *
 * `filtros` é o MESMO objeto que a tela passa aos hooks de dados — não a URL.
 *
 * A primeira versão lia `useSearchParams()`, e isso estava errado de um jeito
 * silencioso: a URL só ganha `de`/`ate` quando alguém mexe no filtro de período.
 * Enquanto ninguém mexe, os gráficos pedem o padrão da tela explicitamente e a
 * requisição da IA ia sem período nenhum — o servidor então aplicava o padrão
 * DELE. Os dois coincidiam por sorte, e passariam a divergir no dia em que
 * alguém mudasse o período padrão em Configurações: o gráfico mostraria 30 dias
 * e a leitura falaria de 90, com toda a autoridade de um texto que cita números.
 *
 * Recebendo os filtros efetivos, não existe segundo lugar de onde divergir.
 */
export function BotaoInsights({ visual, titulo, filtros }) {
  const [aberto, setAberto] = useState(false);
  const { data: meta } = useMeta();
  const { ehAdmin } = useSession();

  // `buildQuery` é o mesmo que monta a query dos gráficos, então a IA recebe o
  // recorte byte a byte igual — inclusive a granularidade.
  const busca = useMemo(() => buildQuery(filtros), [filtros]);

  // sem provedor cadastrado o botão só faz sentido para quem pode cadastrar
  if (meta && !meta.iaConfigurada && !ehAdmin) return null;

  return (
    <>
      <button
        type="button"
        className="btn-ia"
        title="Ler este gráfico com IA"
        onClick={() => setAberto(true)}
      >
        <Icone nome="ia" tamanho={13} />
        <span>Insights</span>
      </button>
      <Painel
        visual={visual}
        titulo={titulo}
        busca={busca}
        aberto={aberto}
        fechar={() => setAberto(false)}
      />
    </>
  );
}
