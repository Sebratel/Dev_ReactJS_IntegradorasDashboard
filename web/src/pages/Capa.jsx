import { useMeta } from '../api';
import { Icone } from '../components/Icone';
import { frescor, haQuanto, labelDataHora } from '../format';

/**
 * Capa ÚNICA do dashboard.
 *
 * Antes eram duas — uma por relatório, como no Power BI, onde cada `.pbip` traz
 * a sua. Viraram uma só por decisão do usuário em 08/09/2026: os três relatórios
 * respondem à mesma pergunta ("como está o atendimento ao cliente?") em canais
 * diferentes — mensageria no Matrix, telefonia no Native e as mensagens ativas de
 * HSM —, então duas capas repetiam objetivo, fontes e contato para dizer quase a
 * mesma coisa.
 *
 * O conteúdo é centralizado com largura máxima: numa tela de 2560px o texto
 * corrido de uma capa fica ilegível esticado de ponta a ponta, e capa é a única
 * tela do dashboard que se lê como documento em vez de se varrer como painel.
 */

const CANAIS = [
  {
    nome: 'MatrixGO · Mensageria',
    desc: 'WhatsApp, Instagram e Messenger. É a maior porta de entrada: fila, TMA, TME, '
      + 'pesquisa de satisfação e as tags que dizem o motivo de cada contato.',
    telas: 'Geral · Matrix, CSAT Matrix, Produtividade, Quartis · Suporte · Matrix · Analíticos · Atendimento',
  },
  {
    nome: 'Native Infinity · Telefonia',
    desc: 'Ligações recebidas e efetuadas. Fila, tempo de espera, abandono e o nível de '
      + 'serviço da operação de voz.',
    telas: 'Geral · Native, CSAT Native · Suporte · Native',
  },
  {
    nome: 'HSM · Mensagens ativas',
    desc: 'O que a empresa dispara para o cliente: cobrança, carnê, pesquisa pós-instalação. '
      + 'Separado entre o que a Meta entregou e o que a automação do n8n conseguiu pedir.',
    telas: 'Analíticos · Mensagens HSM, CX Pós-Instalação',
  },
];

const INDICADORES = [
  ['TMA e TME', 'tempo de atendimento e de espera, nas duas plataformas.'],
  ['Nível de serviço', 'Matrix responde em até 45s, Native atende em até 25s; meta de 90%.'],
  ['CSAT e adesão', 'nota da pesquisa de satisfação e quanta gente respondeu.'],
  ['Produtividade e quartis', 'desempenho individual e a nota final por colaborador.'],
  ['Eventos massivos', 'indisponibilidades e clientes afetados por evento.'],
  ['Entrega de HSM', 'enviadas, entregues, lidas e o motivo de cada não entrega.'],
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
    <div className="page capa-pagina">
      <div className="capa-centro">
        <section className="capa-topo">
          <img src="/logo-circular-sebratel.png" alt="Sebratel" />
          <div className="txt">
            <h2>ATENDIMENTO AO CLIENTE</h2>
            <p>Suporte Técnico · MatrixGO, Native Infinity e mensagens ativas</p>
          </div>
          <div className="selo">
            <div>
              <b>14</b>
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
              <p style={{ marginTop: 0 }}>
                Acompanhar o atendimento ao cliente em <b>todos os canais</b>, com os mesmos números
                dos relatórios do Power BI — mas direto da base, sem espera de atualização.
              </p>
              <ul>
                {INDICADORES.map(([t, d]) => <li key={t}><b>{t}:</b> {d}</li>)}
              </ul>
            </div>
          </article>

          <article className="bloco">
            <h3>Canais</h3>
            <div className="conteudo">
              {CANAIS.map((c) => (
                <div key={c.nome} className="capa-canal">
                  <b>{c.nome}</b>
                  <p>{c.desc}</p>
                  <span>{c.telas}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="bloco">
            <h3>Estado das bases</h3>
            <div className="conteudo">
              <p style={{ marginTop: 0 }}>
                As consultas vão <b>direto ao MariaDB</b> corporativo e ao <b>Elleven</b>{' '}
                (PostgreSQL) — não há carga intermediária. O que aparece aqui é até quando cada
                base <b>tem dado</b>, e não a hora de uma cópia.
              </p>
              <TabelaFontes fontes={meta?.fontes} />
            </div>
          </article>

          <article className="bloco largo">
            <h3>Como ler os indicadores</h3>
            <div className="conteudo">
              <p><b>O relatório de Suporte tem o CHECKPOINT como eixo</b></p>
              <p>
                Seis horas fixas do dia — <b>09:00, 12:00, 15:00, 18:00, 21:00 e 24:00</b> — e cada
                número é <b>acumulado até</b> aquela hora: o de 12h já contém o de 9h. As duas
                exceções são <b>massivas</b> e <b>atendentes</b>, contados por faixa (entre o
                checkpoint anterior e o atual). A meta de entrantes é a média das seis últimas datas
                do mesmo dia da semana, então descreve <b>um dia</b> — período de vários dias soma os
                entrantes contra a régua de um só, e a tela avisa quando isso acontece.
              </p>

              <p><b>TMA e TME não são a mesma conta nas duas plataformas</b></p>
              <ul>
                <li>
                  <b>Matrix:</b> o TMA usa <code>data_finalizacao</code>, que marca quando alguém
                  fecha a conversa — não quando o atendimento termina. Nas telas do relatório GERAL
                  ele sai como <b>mediana</b>, porque 7% das conversas ficam abertas mais de 24h e
                  levam a média para 6h34 contra 26 min de mediana.
                </li>
                <li>
                  <b>Native:</b> vem das colunas de duração da própria base, e sai como{' '}
                  <b>média das ligações atendidas</b> — uma ligação perdida não tem tempo de
                  atendimento.
                </li>
              </ul>

              <p><b>Quartis: como a nota final é montada</b></p>
              <p>
                Cada indicador entra com um peso da tabela <b>workloads_quartiles</b> e uma direção
                (menor é melhor para tempos, maior é melhor para satisfação e tempo logado). O
                quartil vale 100% em Q1, 75% em Q2, 50% em Q3 e 25% em Q4, e a nota é{' '}
                <b>Σ(entrega × peso) ÷ Σ(peso dos indicadores com dado)</b>. Colaborador sem dado num
                indicador — falta, folga, realocação — tem aquele indicador excluído do cálculo, não
                zerado.
              </p>

              <p><b>Divergências propositais em relação ao Power BI</b></p>
              <p>
                Onde o relatório de origem tem erro de agregação, a tela mostra o número correto e
                diz isso no rodapé do visual. Os casos: contagens que somavam o número do protocolo
                em vez de contar linhas, colunas de "média" que eram soma, e o nível de serviço do
                Matrix, cuja fórmula mistura duas formas de contar protocolo quando há transferência.
              </p>
            </div>
          </article>
        </div>

        <div className="rodape">
          <span>Sistema de hospedagem dos Gráficos Gerenciais — Sebratel Tecnologia LTDA · Inteligência de Dados</span>
          <span>Em caso de dúvidas entre em contato: intel@sebratel.com.br</span>
        </div>
      </div>
    </div>
  );
}
