import { useMeta } from '../api';
import { TabelaFontes } from './Capa';
import { haQuanto, labelDataHora } from '../format';

/**
 * Capa do relatório SUP - Indicadores Suporte (página `bd201bbe3ee977a466a0`).
 *
 * Mesmo padrão visual da capa do GERAL — selo com números vivos e o estado das
 * bases. A tabela de fontes é o mesmo componente, e não uma cópia: as duas capas
 * respondem à mesma pergunta sobre as mesmas bases, e duas cópias divergiriam na
 * primeira base nova.
 */
export function CapaSup() {
  const { data: meta, isError } = useMeta();

  return (
    <div className="page">
      <section className="capa-topo">
        <img src="/logo-circular-sebratel.png" alt="Sebratel" />
        <div className="txt">
          <h2>SUP - INDICADORES SUPORTE ATENDIMENTO</h2>
          <p>Nível de serviço, checkpoints do dia e eventos massivos</p>
        </div>
        <div className="selo">
          <div>
            <b>90%</b>
            <span>meta de nível de serviço</span>
          </div>
          <div>
            <b>45s / 25s</b>
            <span>Matrix / Native</span>
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
        </article>

        <article className="bloco">
          <h3>Estado das bases</h3>
          <div className="conteudo">
            <p style={{ marginTop: 0 }}>
              Este relatório usa as bases de atendimento do <b>Matrix</b> e do <b>Native</b>, mais
              o histórico de massivas. As demais aparecem porque as bases são compartilhadas com os
              outros dois relatórios.
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
                  <td>Versão 1.0 — 19/02/2026</td>
                  <td>Primeiro versionamento</td>
                </tr>
                <tr>
                  <td>Versão 2.0 — 07/09/2026</td>
                  <td>Migração para web: acessos por tela, recorte de datas e leitura por IA</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        {/*
          Sem `largo` de propósito. Este bloco entrou junto do de "Estado das
          bases", e como bloco de largura inteira ele criava uma SEGUNDA linha na
          grade — o que fazia esta capa passar a rolar, quando antes ela caía
          inteira em 1366x768. Como quarto bloco da mesma linha, cada um rola por
          dentro (`.capa .bloco .conteudo` já tem `overflow: auto`) e a tela
          continua fechando.
        */}
        <article className="bloco">
          <h3>Como ler esta tela</h3>
          <div className="conteudo">
            <p>
              O eixo deste relatório é o <b>checkpoint</b>, e não o dia: os seis horários abaixo são
              os mesmos em que a atualização roda, e cada indicador é <b>acumulado até</b> aquela
              hora — o de 12h já contém o de 09h.
            </p>
            <p><b>09:00 — 12:00 — 15:00 — 18:00 — 21:00 — 24:00</b></p>

            <p><b>Nível de serviço</b></p>
            <ul>
              <li><b>Matrix</b> — proporção de conversas respondidas em até <b>45 segundos</b>.</li>
              <li><b>Native</b> — proporção de ligações atendidas em até <b>25 segundos</b>.</li>
              <li>A meta dos dois é <b>90%</b>.</li>
            </ul>

            <p><b>A meta de entrantes descreve UM dia</b></p>
            <p>
              Ela é a média das <b>6 últimas datas do mesmo dia da semana</b>. Por isso um período
              de vários dias soma os entrantes de todos eles contra a régua de um só — quando isso
              acontece, a tela avisa em vez de mostrar um desvio que não quer dizer nada.
            </p>

            <p><b>Massivas têm duas fontes</b></p>
            <p>
              Até <b>abr/2026</b> vêm da tabela <code>massive_incidents</code>; depois disso, dos
              protocolos classificados como <b>Massivo</b> ou <b>Incidente de Rede</b>. Os clientes
              afetados saem de <code>DB_Massives.massiva_history</code>, cruzados pelo protocolo. E,
              diferente do resto da tela, massivas são contadas <b>por faixa</b> — não acumuladas.
            </p>
          </div>
        </article>
      </div>

      <div className="rodape">
        <span>Sistema de hospedagem dos Gráficos Gerenciais — Sebratel Tecnologia LTDA · Inteligência de Dados</span>
        <span>Em caso de dúvidas entre em contato: intel@sebratel.com.br</span>
      </div>
    </div>
  );
}
