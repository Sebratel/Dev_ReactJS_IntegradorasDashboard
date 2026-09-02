/**
 * O título original no PBIX desta CAPA está copiado do relatório SUP ("SUP -
 * RELATÓRIOS DETALHADOS INTEGRADORAS") — resquício de duplicar o outro relatório
 * como ponto de partida. Corrigido aqui para o nome real deste relatório.
 */
export function Capa() {
  return (
    <div className="page">
      <div className="capa-topo">
        <img src="/logo-circular-sebratel.png" alt="Sebratel" />
        <div className="txt">
          <h2>GERAL - RELATÓRIOS DETALHADOS INTEGRADORAS</h2>
          <p>Suporte Técnico · MatrixGO e Native Infinity</p>
        </div>
      </div>

      <div className="capa">
        <div className="bloco">
          <h3>Objetivo</h3>
          <div className="conteudo">
            <p>Obter uma visão consolidada dos principais indicadores do time de Suporte Técnico:</p>
            <ul>
              <li>TMA (Native e Matrix)</li>
              <li>TME (Native e Matrix)</li>
              <li>Tempos Logado (Native e Matrix)</li>
              <li>Tempos de Pausas (Native e Matrix)</li>
              <li>Pesquisas de Satisfação CSAT e Adesão CSAT</li>
              <li>Adesão atendimentos × abertura de Protocolos Elleven</li>
            </ul>
          </div>
        </div>

        <div className="bloco">
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
              </tbody>
            </table>
          </div>
        </div>

        <div className="bloco">
          <h3>Programação de Atualizações</h3>
          <div className="conteudo">
            <p>Testes indicam tempo de atualização em torno de <b>20 a 30 minutos</b>.</p>
            <p>Horários de início das atualizações:</p>
            <p><b>07:00 — 13:00 — 19:00</b></p>
          </div>
        </div>

        <div className="bloco largo">
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
        </div>
      </div>

      <div className="rodape">
        <span>Sistema de hospedagem dos Gráficos Gerenciais — Sebratel Tecnologia LTDA · Inteligência de Dados Sebratel</span>
        <span>Em caso de dúvidas entre em contato: intel@sebratel.com.br</span>
      </div>
    </div>
  );
}
