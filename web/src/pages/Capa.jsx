import { useMeta } from '../api';
import { Icone } from '../components/Icone';
import { frescor, haQuanto, labelDataHora } from '../format';

/**
 * O título original no PBIX desta CAPA está copiado do relatório SUP ("SUP -
 * RELATÓRIOS DETALHADOS INTEGRADORAS") — resquício de duplicar o outro relatório
 * como ponto de partida. Corrigido aqui para o nome real deste relatório.
 *
 * O bloco de fontes segue o padrão da capa do `comercial_pbi`: o estado de cada
 * base, com o frescor ao lado. A pergunta que ele responde aqui é diferente, e
 * melhor: lá é "quando o ETL leu", aqui é "até quando a base TEM dado" — mostra a
 * defasagem da origem, não a hora em que alguém copiou. É assim que a base de
 * CSAT do Native aparece parada em dez/2025 na cara de quem abre o relatório, em
 * vez de a tela dela parecer só vazia.
 */

const OBJETIVOS = [
  'TMA (Native e Matrix)',
  'TME (Native e Matrix)',
  'Tempos Logado (Native e Matrix)',
  'Tempos de Pausas (Native e Matrix)',
  'Pesquisas de Satisfação CSAT e Adesão CSAT',
  'Adesão atendimentos × abertura de Protocolos Elleven',
];

/**
 * Quantas horas de atraso são normais em cada base. Atendimento entra ao vivo;
 * o analítico e o HSM vêm de rotina diária, então um dia de defasagem ali é o
 * esperado e não deve acender alerta.
 */
const LIMITE_HORAS = {
  matrix: 6,
  native: 6,
  csatMatrix: 24,
  csatNative: 24,
  atendimentoAnalitico: 48,
  hsm: 48,
  cx: 24,
};

const ROTULO_ESTADO = {
  ok: 'em dia',
  atrasada: 'atrasada',
  parada: 'parada',
  'sem-dado': 'sem dado',
};

export function TabelaFontes({ fontes }) {
  if (!fontes?.length) {
    return <p className="capa-fontes-vazio">Consultando o estado das bases…</p>;
  }
  return (
    <table className="capa-fontes">
      <tbody>
        {fontes.map((f) => {
          const estado = f.erro ? 'sem-dado' : frescor(f.ultimo, LIMITE_HORAS[f.id] ?? 24);
          return (
            <tr key={f.id}>
              <td>
                {f.nome}
                <span className="capa-fonte-rel">{f.relatorio}</span>
              </td>
              <td title={f.erro ? 'A consulta a esta base falhou' : labelDataHora(f.ultimo)}>
                <span className={`fonte-estado ${estado}`}>
                  {estado !== 'ok' && <Icone nome="alerta" tamanho={11} />}
                  {f.erro ? 'indisponível' : haQuanto(f.ultimo)}
                </span>
                {!f.erro && estado !== 'ok' && (
                  <span className="fonte-selo">{ROTULO_ESTADO[estado]}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Capa() {
  const { data: meta, isError } = useMeta();

  const emDia = (meta?.fontes || []).filter(
    (f) => !f.erro && frescor(f.ultimo, LIMITE_HORAS[f.id] ?? 24) === 'ok',
  ).length;

  return (
    <div className="page">
      <section className="capa-topo">
        <img src="/logo-circular-sebratel.png" alt="Sebratel" />
        <div className="txt">
          <h2>GERAL - RELATÓRIOS DETALHADOS INTEGRADORAS</h2>
          <p>Suporte Técnico · MatrixGO e Native Infinity</p>
        </div>
        <div className="selo">
          <div>
            <b>7</b>
            <span>telas</span>
          </div>
          <div>
            <b>{meta?.fontes ? `${emDia}/${meta.fontes.length}` : '—'}</b>
            <span>bases em dia</span>
          </div>
          <div>
            <b title={labelDataHora(meta?.matrix)}>
              {isError ? '—' : meta?.matrix ? haQuanto(meta.matrix) : '—'}
            </b>
            <span>último atendimento</span>
          </div>
        </div>
      </section>

      <div className="capa">
        <article className="bloco">
          <h3>Objetivo</h3>
          <div className="conteudo">
            <p>Obter uma visão consolidada dos principais indicadores do time de Suporte Técnico:</p>
            <ul>{OBJETIVOS.map((o) => <li key={o}>{o}</li>)}</ul>
          </div>
        </article>

        <article className="bloco">
          <h3>Estado das bases</h3>
          <div className="conteudo">
            <p style={{ marginTop: 0 }}>
              As consultas vão <b>direto ao MariaDB</b> corporativo e ao <b>Elleven</b>
              {' '}(PostgreSQL) — não há carga intermediária. O que aparece aqui é até quando cada
              base <b>tem dado</b>, e não a hora de uma cópia.
            </p>
            <TabelaFontes fontes={meta?.fontes} />
          </div>
        </article>

        <article className="bloco">
          <h3>Power BI - Sebratel · Histórico de Revisões</h3>
          <div className="conteudo">
            <table className="capa-fontes">
              <tbody>
                <tr>
                  <td>Versão 1.0 — 01/04/2026</td>
                  <td>Primeiro versionamento</td>
                </tr>
                <tr>
                  <td>Versão 1.1 — 01/06/2026</td>
                  <td>Adicionado os Quartis</td>
                </tr>
                <tr>
                  <td>Versão 1.2 — 13/08/2026</td>
                  <td>
                    Incluída tabela de supervisores × colaboradores —{' '}
                    <a
                      href="https://docs.google.com/spreadsheets/d/1oxUh22owr2smvIDMNVv0UUp9QKhrvYTEIakyZs2Zevk/edit?gid=0#gid=0"
                      target="_blank"
                      rel="noreferrer"
                    >
                      link de acesso
                    </a>
                  </td>
                </tr>
                <tr>
                  <td>Versão 2.0 — 07/09/2026</td>
                  <td>Migração para web: acessos por tela, recorte de datas e leitura por IA</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="bloco largo">
          <h3>Quartis - Regras e Definições</h3>
          <div className="conteudo">
            <p>
              O motor de cálculo distribui os Quartis seguindo as diretrizes abaixo, de forma a
              assegurar a justiça e coerência operacional:
            </p>

            <p><b>1 — Lógica: Menor é Melhor (sinal ≤)</b></p>
            <p>
              Premia tempos de atendimento mais ágeis, menores esperas em fila e menor tempo
              ocioso de pausa.
            </p>
            <ul>
              <li><b>TMA (Native e Matrix)</b> — Tempo Médio de Atendimento.</li>
              <li><b>TME (Native e Matrix)</b> — Tempo Médio de Espera.</li>
              <li><b>Tempo de Pausas (Native e Matrix)</b> — média diária de tempo em pausa.</li>
            </ul>
            <p>
              Regra de distribuição: agente ≤ P25 → <b>Q1</b> · agente ≤ P50 → <b>Q2</b> · agente ≤ P75
              → <b>Q3</b> · agente &gt; P75 → <b>Q4</b>.
            </p>

            <p><b>2 — Lógica: Maior é Melhor (sinal ≥)</b></p>
            <p>Premia a maior retenção logada, o engajamento com as escalas e os resultados de satisfação.</p>
            <ul>
              <li><b>CSAT (Matrix)</b> — nota de satisfação atribuída pelo cliente.</li>
              <li><b>Adesão CSAT (Matrix)</b> — percentual de aderência e volume de avaliações coletadas.</li>
              <li><b>Tempo Logado (Native e Matrix)</b> — média diária de tempo conectado em sistema.</li>
            </ul>
            <p>
              Regra de distribuição: agente ≥ P75 → <b>Q1</b> · agente ≥ P50 → <b>Q2</b> · agente ≥ P25
              → <b>Q3</b> · agente &lt; P25 → <b>Q4</b>.
            </p>

            <p><b>Estrutura de Pesos e Consolidação da Nota Final</b></p>
            <p>
              A Nota Final de desempenho é obtida através do somatório ponderado das entregas de
              cada indicador. Cada classificação de quartil possui uma equivalência percentual fixa
              de conversão:
            </p>
            <table className="capa-fontes">
              <thead>
                <tr><td><b>Quartil</b></td><td><b>% de Entrega · Conceito</b></td></tr>
              </thead>
              <tbody>
                <tr><td>Q1</td><td>100% — Alta Performance (topo do ranking)</td></tr>
                <tr><td>Q2</td><td>75% — Desempenho Adequado (acima da mediana)</td></tr>
                <tr><td>Q3</td><td>50% — Abaixo da Mediana (necessidade de desenvolvimento)</td></tr>
                <tr><td>Q4</td><td>25% — Baixa Performance ou Ausência de Dados/Falta</td></tr>
              </tbody>
            </table>
            <p>
              A fórmula que consolida a Nota Definitiva do colaborador e amarra os pesos
              institucionais da tabela <b>workloads_quartiles</b> é definida por:
            </p>
            <p><b>Nota Final = Σ ( % Entrega × Peso ) / Σ ( Peso dos indicadores com dados e peso &gt; 0 )</b></p>
            <p>
              Obs: colaboradores que não geraram dados em um indicador no período — por faltas,
              suspensões, folgas ou realocações definitivas para outra frente — têm aquele
              indicador retornado como vazio e excluído integralmente do cálculo para aquele
              indicador.
            </p>
          </div>
        </article>
      </div>

      <div className="rodape">
        <span>Sistema de hospedagem dos Gráficos Gerenciais — Sebratel Tecnologia LTDA · Inteligência de Dados Sebratel</span>
        <span>Em caso de dúvidas entre em contato: intel@sebratel.com.br</span>
      </div>
    </div>
  );
}
