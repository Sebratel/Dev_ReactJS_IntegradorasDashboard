/** Capa do relatório SUP - Indicadores Suporte (página `bd201bbe3ee977a466a0`). */
export function CapaSup() {
  return (
    <div className="page">
      <div className="capa-topo">
        <img src="/logo-circular-sebratel.png" alt="Sebratel" />
        <div className="txt">
          <h2>SUP - INDICADORES SUPORTE ATENDIMENTO</h2>
          <p>Nível de serviço, checkpoints do dia e eventos massivos</p>
        </div>
      </div>

      <div className="capa">
        <div className="bloco">
          <h3>Objetivo</h3>
          <div className="conteudo">
            <ul>
              <li>Mostrar o total de ligações recebidas e efetuadas em um período específico (diário, semanal, mensal)</li>
              <li>Medir o tempo médio que os operadores levam para atender uma ligação</li>
              <li>Mostrar o percentual de ligações atendidas dentro de um tempo pré-definido</li>
              <li>Analisar o tempo que os clientes aguardam na fila antes de serem atendidos</li>
              <li>Medir a produtividade dos operadores</li>
              <li>Medir o percentual de problemas resolvidos na primeira ligação, sem necessidade de retorno</li>
              <li>Identificar os horários ou dias com maior volume de ligações</li>
            </ul>
          </div>
        </div>

        <div className="bloco">
          <h3>Power BI - Sebratel · Histórico de Revisões</h3>
          <div className="conteudo">
            <table className="capa-fontes">
              <tbody>
                <tr>
                  <td>Versão 1.0 — 19/02/2026</td>
                  <td>Primeiro versionamento</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="bloco">
          <h3>Programação de Atualizações</h3>
          <div className="conteudo">
            <p>Testes indicam tempo de atualização em torno de <b>10 minutos</b>.</p>
            <p>Horários de início das atualizações:</p>
            <p><b>09:00 — 12:00 — 15:00 — 18:00 — 21:00 — 24:00</b></p>
            <p>
              São as mesmas seis horas dos <b>checkpoints</b> do relatório: os indicadores das
              telas são acumulados até cada uma delas.
            </p>
          </div>
        </div>
      </div>

      <div className="rodape">
        <span>Sistema de hospedagem dos Gráficos Gerenciais — Sebratel Tecnologia LTDA · Inteligência de Dados</span>
        <span>Em caso de dúvidas entre em contato: intel@sebratel.com.br</span>
      </div>
    </div>
  );
}
