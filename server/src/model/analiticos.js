import { query } from '../db/maria.js';
import {
  CATEGORIAS_ISA, chavesDeTelefone, combinacaoAtendeIsa, combinacaoEhEncerramentoIsa,
  ehTagCxNok, ehTagCxOk, ehTagCx, ehTagDeAssunto, ehTagMarketing, familiaDaTag,
  motivoLegivel, normalizarRecorrencia, separarTags, soDigitos, tagAmigavel,
} from './tags.js';

/**
 * Relatórios analíticos que a aplicação `dev_ReactJs_DashboardUX` mostra hoje.
 *
 * Lá eles chegam por caminhos frágeis: o analítico de atendimento e o de HSM são
 * RASPADOS da interface web do MatrixGO com Playwright (login, preencher
 * formulário, clicar em "Exportar CSV") e o de CX vem da API pública do Data Hub,
 * com token e limite de 10 requisições por minuto. Depois o CSV é parseado no
 * navegador.
 *
 * Os três já existem prontos no MariaDB, atualizados até hoje:
 *   atendimento -> API_WebDeveloper.db_matrix_atendimento_analitico  (1,6 mi linhas)
 *   HSM         -> API_WebDeveloper.db_matrix_hsms_enviados          (247 mil)
 *   CX          -> DB_Applicattion.matrix_hsm_cx_post_installation   (5,2 mil)
 *
 * Então aqui é SQL direto: sem navegador, sem CSV, sem token e sem limite de
 * requisição — que é o "de forma automática" pedido.
 *
 * O recorte de período usa `report_date`/data do disparo (coluna de data própria),
 * não o timestamp, porque é por ela que as tabelas são organizadas.
 */

const ATENDIMENTO = 'API_WebDeveloper.db_matrix_atendimento_analitico';
const HSM = 'API_WebDeveloper.db_matrix_hsms_enviados';
const CX = 'DB_Applicattion.matrix_hsm_cx_post_installation';

/** Status do HSM que representam entrega bem-sucedida; o resto é falha. */
const HSM_OK = ['Lida', 'Entregue', 'Enviada'];

/**
 * O fluxo do n8n que É a pesquisa pós-instalação.
 *
 * A tabela guarda quatro automações diferentes, e só esta é CX. Medido em
 * 08/09/2026: `cs_cx_72hrs` são 1.430 disparos e `Billing_Collection_6Days_Overdue`
 * outros 3.975 — a cobrança é quase três vezes o CX. Enquanto a tela de CX olhava
 * a tabela inteira, todo indicador dela descrevia sobretudo a cobrança, e a
 * "cobertura por cidade" era dominada por 3.978 linhas sem cidade, que são
 * justamente as de cobrança (só o fluxo de CX preenche cidade e bairro).
 *
 * Por isso a tela de CX passa a fixar este fluxo, e a visão geral dos quatro
 * mudou para a tela de HSM — que é onde a pergunta "quanto a gente disparou"
 * pertence. Decisão do usuário em 08/09/2026.
 */
const FLUXO_CX = 'cs_cx_72hrs';

const listaDe = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((s) => s.trim()).filter(Boolean);

function filtroIn(coluna, valores, where, params) {
  const lista = listaDe(valores);
  if (!lista.length) return;
  where.push(`${coluna} IN (${lista.map(() => '?').join(',')})`);
  params.push(...lista);
}

const num = (v) => (v === null || v === undefined ? null : Number(v));
const soData = (d) => String(d).slice(0, 10);
const rotuloDia = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

// --------------------------------------------------------------- ATENDIMENTO

export async function atendimento(filtros) {
  const where = ['report_date >= ?', 'report_date <= ?'];
  const params = [soData(filtros.de), soData(filtros.ateInclusivo)];
  filtroIn('status', filtros.status, where, params);
  filtroIn('channel', filtros.canal, where, params);
  filtroIn("case when is_receptive = 1 then 'Receptivo' else 'Ativo' end", filtros.ativoReceptivo, where, params);
  const onde = where.join(' AND ');

  const [porStatus, porDia, porHora, porCanal, porFila, tempos, porTipo, recorrencia, combinacoes, inativNoturno] = await Promise.all([
    query(`select status, count(*) n from ${ATENDIMENTO} where ${onde} group by status order by n desc`, params),
    query(`select report_date dia, count(*) n,
                  sum(case when status = 'Finalizado' then 1 else 0 end) finalizados
             from ${ATENDIMENTO} where ${onde} group by dia order by dia`, params),
    query(`select hour(entry_at) hora, count(*) n from ${ATENDIMENTO}
            where ${onde} and entry_at is not null group by hora order by hora`, params),
    query(`select channel, case when is_receptive = 1 then 'Receptivo' else 'Ativo' end sentido, count(*) n
             from ${ATENDIMENTO} where ${onde} and channel <> '' group by channel, sentido order by n desc`, params),
    query(`select coalesce(nullif(service_name, ''), '(sem fila)') fila, count(*) n,
                  avg(nullif(queue_duration, 0)) espera, avg(nullif(service_duration, 0)) atendimento
             from ${ATENDIMENTO} where ${onde} group by fila order by n desc limit 25`, params),
    query(`select status, count(*) n, avg(nullif(queue_duration, 0)) espera, avg(nullif(service_duration, 0)) atendimento
             from ${ATENDIMENTO} where ${onde} group by status order by n desc`, params),
    // "Tipo" da app original: Automático / Misto / Humano / Notificação
    query(`select coalesce(nullif(service_type, ''), '(sem tipo)') tipo, count(*) n
             from ${ATENDIMENTO} where ${onde} group by tipo order by n desc`, params),
    query(`select recurrence r, count(*) n from ${ATENDIMENTO}
            where ${onde} and recurrence is not null and recurrence <> '' group by r`, params),
    /**
     * A consulta que alimenta CINCO visões: motivo do contato, encerramentos da
     * ISA, campanhas de marketing, jornada no bot e a contagem de "sem tag".
     *
     * Agrupa as COMBINAÇÕES de tag e deixa a explosão para o Node — 30 dias são
     * 65 mil atendimentos que colapsam em 389 linhas aqui. O `status` entra no
     * agrupamento porque a jornada mostra o desfecho dominante de cada caminho.
     */
    query(`select tag, status, count(*) n from ${ATENDIMENTO}
            where ${onde} group by tag, status`, params),
    // insight de inatividade noturna: 0h–6h, que o gráfico por hora não isola
    query(`select count(*) n, avg(nullif(service_duration, 0)) media
             from ${ATENDIMENTO}
            where ${onde} and status = 'Finalizado por inatividade'
              and entry_at is not null and hour(entry_at) < 7`, params),
  ]);

  const total = porStatus.rows.reduce((s, r) => s + num(r.n), 0);
  const de = (nome) => num(porStatus.rows.find((r) => r.status === nome)?.n) || 0;

  const tags = agregarTags(combinacoes.rows, total);
  const tipos = porTipo.rows.map((r) => ({ chave: r.tipo, n: num(r.n) }));
  const doTipo = (nome) => num(tipos.find((t) => t.chave === nome)?.n) || 0;

  // recorrência: soma as ocorrências no mesmo grupo (ver `normalizarRecorrencia`)
  const recAgrupada = new Map();
  for (const r of recorrencia.rows) {
    const chave = normalizarRecorrencia(r.r);
    if (!chave) continue;
    recAgrupada.set(chave, (recAgrupada.get(chave) || 0) + num(r.n));
  }
  const porRecorrencia = [...recAgrupada.entries()]
    .map(([chave, n]) => ({ chave, n }))
    .sort((a, b) => b.n - a.n);
  const totalRecorrentes = porRecorrencia.reduce((s, r) => s + r.n, 0);
  const reincidentes = porRecorrencia
    .filter((r) => /reincidente|rechamada/i.test(r.chave))
    .reduce((s, r) => s + r.n, 0);

  const noturno = inativNoturno.rows[0] || {};
  const tempoInativ = tempos.rows.find((r) => r.status === 'Finalizado por inatividade');

  return {
    kpis: {
      total,
      finalizados: de('Finalizado'),
      inatividade: de('Finalizado por inatividade'),
      automatico: de('Automático'),
      transferidos: de('Transferido') + de('Transferido Pendência - Fila Prioritária'),
      emPesquisa: de('Em pesquisa'),
      // do bloco de tags e tipos
      semTag: tags.semTag,
      passouSuporte: tags.passouSuporte,
      isaTotal: tags.isa.total,
      tipoAutomatico: doTipo('Automático'),
    },
    porStatus: porStatus.rows.map((r) => ({ chave: r.status || '(sem status)', n: num(r.n) })),
    porDia: porDia.rows.map((r) => ({
      periodo: soData(r.dia), label: rotuloDia(soData(r.dia)),
      total: num(r.n), finalizados: num(r.finalizados),
    })),
    porHora: porHora.rows.map((r) => ({
      periodo: String(r.hora), label: `${String(r.hora).padStart(2, '0')}h`, total: num(r.n),
    })),
    porCanal: porCanal.rows.map((r) => ({ chave: `${r.channel} · ${r.sentido}`, n: num(r.n) })),
    porTipo: tipos,
    porFila: porFila.rows.map((r) => ({
      chave: r.fila, n: num(r.n),
      esperaSeg: r.espera === null ? null : Math.round(num(r.espera)),
      atendimentoSeg: r.atendimento === null ? null : Math.round(num(r.atendimento)),
    })),
    tempoPorStatus: tempos.rows.map((r) => ({
      chave: r.status || '(sem status)', n: num(r.n),
      esperaSeg: r.espera === null ? null : Math.round(num(r.espera)),
      atendimentoSeg: r.atendimento === null ? null : Math.round(num(r.atendimento)),
    })),

    // ---- o que vem das tags ----
    isa: tags.isa,
    marketing: tags.marketing,
    motivos: tags.motivos,
    jornada: tags.jornada,
    tagsPorFamilia: tags.porFamilia,

    porRecorrencia,
    recorrencia: { total: totalRecorrentes, reincidentes },

    /**
     * Efetividade automática: a fração resolvida sem gente. `Misto` é o caso em
     * que o bot começou e um humano terminou, e fica num bloco próprio de
     * propósito — somá-lo ao automático inflaria o indicador com atendimentos
     * que consumiram agente.
     */
    efetividade: {
      automatico: doTipo('Automático'),
      misto: doTipo('Misto'),
      humano: doTipo('Humano'),
      notificacao: doTipo('Notificação'),
      outros: total - doTipo('Automático') - doTipo('Misto') - doTipo('Humano') - doTipo('Notificação'),
      taxa: total ? doTipo('Automático') / total : null,
    },

    /** Números que a tela transforma nas leituras de "Análise & Insights". */
    insights: {
      inatividadeNoturna: num(noturno.n) || 0,
      mediaInatividadeSeg: noturno.media === null || noturno.media === undefined
        ? (tempoInativ?.atendimento ? Math.round(num(tempoInativ.atendimento)) : null)
        : Math.round(num(noturno.media)),
      passouSuporte: tags.passouSuporte,
      semTag: tags.semTag,
      reincidentes,
      tipoAutomatico: doTipo('Automático'),
    },
  };
}

/**
 * Explode as combinações de tag nas visões da tela.
 *
 * Recebe as linhas de `group by tag, status` e devolve tudo o que depende de
 * tag. Uma passagem só sobre algumas centenas de linhas — ver o cabeçalho de
 * `tags.js` para a medição que justificou fazer assim.
 */
function agregarTags(linhas, total) {
  const contar = (mapa, chave, n) => mapa.set(chave, (mapa.get(chave) || 0) + n);

  const motivos = new Map();
  const marketing = new Map();
  const porFamilia = new Map();
  const isaPorCategoria = new Map(CATEGORIAS_ISA.map((c) => [c.id, 0]));
  const jornadas = new Map(); // combinação -> { tags, n, status: Map }

  let semTag = 0;
  let passouSuporte = 0;
  let isaTotal = 0;
  let comMarketing = 0;

  for (const linha of linhas) {
    const n = Number(linha.n) || 0;
    const status = linha.status || '(sem status)';
    const tags = separarTags(linha.tag);

    if (!tags.length) {
      semTag += n;
      continue;
    }

    // jornada: a combinação inteira, na ordem em que o cliente passou
    const chaveJornada = tags.join(' || ');
    if (!jornadas.has(chaveJornada)) {
      jornadas.set(chaveJornada, { tags, n: 0, status: new Map() });
    }
    const j = jornadas.get(chaveJornada);
    j.n += n;
    contar(j.status, status, n);

    if (combinacaoEhEncerramentoIsa(tags)) isaTotal += n;
    for (const c of CATEGORIAS_ISA) {
      if (combinacaoAtendeIsa(tags, c)) isaPorCategoria.set(c.id, isaPorCategoria.get(c.id) + n);
    }

    // "passou pelo suporte/financeiro no bot": uma vez por atendimento, não por tag
    if (tags.some((t) => /suporte|financeiro/i.test(t))) passouSuporte += n;
    if (tags.some(ehTagMarketing)) comMarketing += n;

    for (const t of tags) {
      contar(porFamilia, familiaDaTag(t), n);
      if (ehTagDeAssunto(t)) contar(motivos, t, n);
      if (ehTagMarketing(t)) contar(marketing, t, n);
    }
  }

  const lista = (mapa, base) => [...mapa.entries()]
    .map(([chave, n]) => ({ chave, n, pct: base ? n / base : null }))
    .sort((a, b) => b.n - a.n);

  return {
    semTag,
    passouSuporte,
    motivos: [
      ...lista(motivos, total).map((m) => ({
        ...m,
        // o rótulo legível vai junto do original: a tela mostra um e o `title`
        // guarda o outro, para quem precisa achar a tag no MatrixGO
        label: motivoLegivel(m.chave),
        familia: familiaDaTag(m.chave),
      })),
      // "sem tag" fecha a lista: é a lacuna de análise, não um motivo
      ...(semTag ? [{
        chave: '(sem tag)', label: 'Sem tag identificada', familia: 'nenhuma',
        n: semTag, pct: total ? semTag / total : null, semDado: true,
      }] : []),
    ],
    marketing: {
      total: comMarketing,
      pct: total ? comMarketing / total : null,
      itens: lista(marketing, comMarketing),
    },
    isa: {
      total: isaTotal,
      pct: total ? isaTotal / total : null,
      categorias: CATEGORIAS_ISA.map((c) => ({
        id: c.id,
        label: c.label,
        n: isaPorCategoria.get(c.id),
      })),
    },
    porFamilia: lista(porFamilia, null),
    jornada: [...jornadas.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 40)
      .map((j) => {
        const dominante = [...j.status.entries()].sort((a, b) => b[1] - a[1])[0];
        return {
          passos: j.tags.map((t) => ({ tag: tagAmigavel(t), familia: familiaDaTag(t) })),
          n: j.n,
          status: dominante?.[0] || null,
        };
      }),
  };
}

// ----------------------------------------------------------------------- HSM

export async function hsm(filtros) {
  const where = ['report_date >= ?', 'report_date <= ?'];
  const params = [soData(filtros.de), soData(filtros.ateInclusivo)];
  filtroIn('template_name', filtros.template, where, params);
  filtroIn('category', filtros.categoria, where, params);
  const onde = where.join(' AND ');

  const entregue = `status IN (${HSM_OK.map(() => '?').join(',')})`;
  // os `?` do status aparecem no SELECT, ANTES dos da cláusula WHERE — o mysql2
  // liga por posição na string, então a ordem aqui é essa e não a inversa
  const paramsComOk = [...HSM_OK, ...params];

  const [porStatus, porDia, porTemplate, porCategoria] = await Promise.all([
    query(`select status, count(*) n from ${HSM} where ${onde} group by status order by n desc`, params),
    query(`select report_date dia, count(*) enviadas,
                  sum(case when status = 'Lida' then 1 else 0 end) lidas,
                  sum(case when status in ('Lida','Entregue') then 1 else 0 end) entregues,
                  sum(case when ${entregue} then 0 else 1 end) falhas
             from ${HSM} where ${onde} group by dia order by dia`, paramsComOk),
    // `entregues` entrou aqui: sem ela a tabela por template não tinha taxa de
    // entrega, só de leitura — e é a taxa de entrega que separa "template ruim"
    // de "público ruim"
    query(`select template_name, category, count(*) enviadas,
                  sum(case when status = 'Lida' then 1 else 0 end) lidas,
                  sum(case when status in ('Lida','Entregue') then 1 else 0 end) entregues,
                  sum(case when ${entregue} then 0 else 1 end) falhas
             from ${HSM} where ${onde} and template_name <> ''
            group by template_name, category order by enviadas desc limit 30`, paramsComOk),
    query(`select coalesce(nullif(category, ''), '(sem categoria)') categoria, count(*) n
             from ${HSM} where ${onde} group by categoria order by n desc`, params),
  ]);

  const conta = (nome) => num(porStatus.rows.find((r) => r.status === nome)?.n) || 0;
  const enviadas = porStatus.rows.reduce((s, r) => s + num(r.n), 0);
  const lidas = conta('Lida');
  const entregues = lidas + conta('Entregue');
  const falhas = porStatus.rows
    .filter((r) => !HSM_OK.includes(r.status))
    .reduce((s, r) => s + num(r.n), 0);

  const taxa = (a, b) => (b ? a / b : null);

  return {
    kpis: {
      enviadas,
      entregues,
      lidas,
      falhas,
      taxaEntrega: taxa(entregues, enviadas),
      taxaLeitura: taxa(lidas, enviadas),
      // ler sobre o ENTREGUE é a leitura honesta do interesse: quem não recebeu
      // não tinha como ler, e diluir isso na base de enviadas esconde template ruim
      taxaLeituraDoEntregue: taxa(lidas, entregues),
      diasComEnvio: porDia.rows.length,
      /**
       * A app original tem um KPI "Respondidas", que vem de uma coluna do CSV
       * analítico do MatrixGO. A tabela não guarda esse dado — conferido: zero
       * linhas com status contendo "respond" — então o número seria sempre 0.
       * Fica declarado como indisponível para a tela poder dizer isso, em vez de
       * mostrar um zero que parece resultado.
       */
      respondidas: null,
    },

    /**
     * Funil de entrega. Cada etapa traz a fração sobre o ENVIADO, que é a base
     * que não muda de degrau para degrau — é o que deixa o funil comparável.
     */
    funil: [
      { chave: 'Enviadas', n: enviadas, pct: 1 },
      { chave: 'Entregues', n: entregues, pct: taxa(entregues, enviadas) },
      { chave: 'Lidas', n: lidas, pct: taxa(lidas, enviadas) },
      { chave: 'Não entregues', n: falhas, pct: taxa(falhas, enviadas), ruim: true },
    ],

    // "motivo da falha" aqui é o próprio status: é assim que a plataforma reporta
    // (ex.: "A Meta decidiu não entregar a mensagem")
    falhas: porStatus.rows
      .filter((r) => !HSM_OK.includes(r.status))
      .map((r) => ({ chave: r.status || '(sem status)', n: num(r.n), pct: taxa(num(r.n), falhas) })),
    porStatus: porStatus.rows.map((r) => ({
      chave: r.status || '(sem status)',
      n: num(r.n),
      pct: taxa(num(r.n), enviadas),
      entregou: HSM_OK.includes(r.status),
    })),
    porDia: porDia.rows.map((r) => ({
      periodo: soData(r.dia), label: rotuloDia(soData(r.dia)),
      enviadas: num(r.enviadas), entregues: num(r.entregues), lidas: num(r.lidas), falhas: num(r.falhas),
      taxaEntrega: taxa(num(r.entregues), num(r.enviadas)),
      taxaLeitura: taxa(num(r.lidas), num(r.enviadas)),
    })),
    porTemplate: porTemplate.rows.map((r) => ({
      chave: r.template_name, categoria: r.category, enviadas: num(r.enviadas),
      entregues: num(r.entregues), lidas: num(r.lidas), falhas: num(r.falhas),
      taxaEntrega: taxa(num(r.entregues), num(r.enviadas)),
      taxaLeitura: taxa(num(r.lidas), num(r.enviadas)),
    })),
    porCategoria: porCategoria.rows.map((r) => ({ chave: r.categoria, n: num(r.n), pct: taxa(num(r.n), enviadas) })),
  };
}

/**
 * Mensagens HSM que não foram entregues, para o detalhamento de um motivo.
 *
 * A tela lista os motivos e abre a lista de quem caiu em cada um — sem isso o
 * motivo é um número sem ação possível.
 */
export async function detalhamentoFalhasHsm(filtros, limite = 300) {
  const where = ['report_date >= ?', 'report_date <= ?', `status NOT IN (${HSM_OK.map(() => '?').join(',')})`];
  const params = [soData(filtros.de), soData(filtros.ateInclusivo), ...HSM_OK];
  filtroIn('template_name', filtros.template, where, params);
  filtroIn('category', filtros.categoria, where, params);
  if (filtros.motivo) {
    where.push('status = ?');
    params.push(String(filtros.motivo));
  }
  const { rows } = await query(
    `select sent_at, template_name, category, phone, contact_name, status, protocol_number
       from ${HSM} where ${where.join(' AND ')}
      order by sent_at desc limit ?`,
    [...params, limite],
  );
  return rows.map((r) => ({
    enviadaEm: r.sent_at,
    template: r.template_name,
    categoria: r.category,
    telefone: r.phone,
    contato: r.contact_name,
    motivo: r.status,
    protocolo: r.protocol_number,
  }));
}

// ------------------------------------------------------------------------ CX

/**
 * A tabela não é só de pós-instalação: guarda três fluxos do n8n (cobrança com 6
 * dias de atraso, o CX de 72h após a instalação e a verificação de sinal depois de
 * massiva). Por isso o fluxo é um filtro da tela, e não uma suposição.
 */
export async function cx(filtros) {
  // fluxo FIXO: esta tela é a da pesquisa pós-instalação, não a dos disparos
  const where = ['data_hora_disparo >= ?', 'data_hora_disparo < ?', 'n8n_flow = ?'];
  const params = [filtros.de, filtros.ate, FLUXO_CX];
  filtroIn('cliente_cidade', filtros.cidade, where, params);
  const onde = where.join(' AND ');

  const [porDia, porFluxo, porCidade, porBairro, porMensagem, total, respostas, tagsCx] = await Promise.all([
    query(`select date(data_hora_disparo) dia, count(*) disparos,
                  sum(case when status_envio = 1 then 1 else 0 end) sucesso
             from ${CX} where ${onde} group by dia order by dia`, params),
    query(`select n8n_flow fluxo, count(*) disparos,
                  sum(case when status_envio = 1 then 1 else 0 end) sucesso
             from ${CX} where ${onde} group by fluxo order by disparos desc`, params),
    query(`select coalesce(nullif(cliente_cidade, ''), '(sem cidade)') cidade, count(*) disparos,
                  sum(case when status_envio = 1 then 1 else 0 end) sucesso
             from ${CX} where ${onde} group by cidade order by disparos desc limit 25`, params),
    query(`select coalesce(nullif(cliente_bairro, ''), '(sem bairro)') bairro,
                  coalesce(nullif(cliente_cidade, ''), '(sem cidade)') cidade, count(*) disparos,
                  sum(case when status_envio = 1 then 1 else 0 end) sucesso
             from ${CX} where ${onde} group by bairro, cidade order by disparos desc limit 25`, params),
    // a mensagem de retorno é o "motivo": sucesso vem como texto, falha vem com o
    // código HTTP e o corpo do erro, que fica longo — o corte deixa o motivo legível
    query(`select left(coalesce(nullif(mensagem_envio, ''), '(sem retorno)'), 70) motivo,
                  count(*) n, status_envio
             from ${CX} where ${onde} group by motivo, status_envio order by n desc limit 20`, params),
    query(`select count(*) disparos, sum(case when status_envio = 1 then 1 else 0 end) sucesso,
                  count(distinct cliente_contrato) contratos,
                  count(distinct nullif(cliente_cidade, '')) cidades,
                  min(data_hora_disparo) primeiro, max(data_hora_disparo) ultimo
             from ${CX} where ${onde}`, params),
    respostasCx(filtros),
    tagsDeCx(filtros),
  ]);

  const t = total.rows[0] || {};
  const disparos = num(t.disparos) || 0;
  const sucesso = num(t.sucesso) || 0;
  const taxa = (a, b) => (b ? a / b : null);

  return {
    kpis: {
      disparos,
      sucesso,
      falha: disparos - sucesso,
      contratos: num(t.contratos) || 0,
      cidades: num(t.cidades) || 0,
      taxaSucesso: taxa(sucesso, disparos),
      primeiroDisparo: t.primeiro || null,
      ultimoDisparo: t.ultimo || null,
      // ---- da pesquisa de satisfação (tags CS_CX_72HRS_*) ----
      avaliacoes: respostas.total,
      ok: respostas.ok,
      nok: respostas.nok,
      score: respostas.score,
      /**
       * Quantos dos disparos bem-sucedidos viraram resposta. A base é o SUCESSO
       * do disparo, e não o total: cobrar resposta de quem nunca recebeu a
       * mensagem misturaria problema de entrega com desinteresse.
       */
      taxaResposta: taxa(respostas.total, sucesso),
    },
    porDia: porDia.rows.map((r) => ({
      periodo: soData(r.dia), label: rotuloDia(soData(r.dia)),
      disparos: num(r.disparos), sucesso: num(r.sucesso),
      falha: num(r.disparos) - num(r.sucesso),
    })),
    porFluxo: porFluxo.rows.map((r) => ({
      chave: r.fluxo || '(sem fluxo)', disparos: num(r.disparos), sucesso: num(r.sucesso),
      taxa: taxa(num(r.sucesso), num(r.disparos)),
    })),
    porCidade: porCidade.rows.map((r) => ({
      chave: r.cidade, disparos: num(r.disparos), sucesso: num(r.sucesso),
      taxa: taxa(num(r.sucesso), num(r.disparos)),
    })),
    porBairro: porBairro.rows.map((r) => ({
      chave: `${r.bairro} · ${r.cidade}`, disparos: num(r.disparos), sucesso: num(r.sucesso),
      taxa: taxa(num(r.sucesso), num(r.disparos)),
    })),
    porMensagem: porMensagem.rows.map((r) => ({
      chave: r.motivo, n: num(r.n), sucesso: num(r.status_envio) === 1,
      pct: taxa(num(r.n), disparos),
    })),

    // ---- pesquisa de satisfação ----
    respostas: {
      ok: respostas.ok,
      nok: respostas.nok,
      total: respostas.total,
      score: respostas.score,
      porDia: respostas.porDia,
    },
    tagsCx,
  };
}

/**
 * A pesquisa de satisfação pós-instalação, medida pelas tags do atendimento.
 *
 * Quem responde a pesquisa gera um atendimento no MatrixGO marcado com
 * `CS_CX_72HRS_OK` ou `CS_CX_72HRS_NOK` — é daí, e não da tabela de disparos, que
 * sai o CX Score. Conferido na base: 1.875 OK e 422 NOK no histórico.
 *
 * A janela é a do ATENDIMENTO, não a do disparo: a pessoa responde quando quer, e
 * amarrar a resposta à data do disparo perderia quem respondeu no dia seguinte.
 */
async function respostasCx(filtros) {
  const { rows } = await query(
    `select date(entry_at) dia, tag, count(*) n
       from ${ATENDIMENTO}
      where entry_at >= ? and entry_at < ?
        and (tag like '%CS_CX_72HRS_OK%' or tag like '%CS_CX_72HRS_NOK%')
      group by dia, tag`,
    [filtros.de, filtros.ate],
  );

  let ok = 0;
  let nok = 0;
  const porDia = new Map();
  for (const r of rows) {
    const tags = separarTags(r.tag);
    const ehOk = tags.some(ehTagCxOk);
    const ehNok = tags.some(ehTagCxNok);
    const n = num(r.n);
    const dia = soData(r.dia);
    if (!porDia.has(dia)) porDia.set(dia, { ok: 0, nok: 0 });
    if (ehOk) { ok += n; porDia.get(dia).ok += n; }
    if (ehNok) { nok += n; porDia.get(dia).nok += n; }
  }

  const total = ok + nok;
  return {
    ok,
    nok,
    total,
    score: total ? ok / total : null,
    porDia: [...porDia.entries()]
      .filter(([, v]) => v.ok || v.nok)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dia, v]) => ({
        periodo: dia, label: rotuloDia(dia), ok: v.ok, nok: v.nok,
        total: v.ok + v.nok, score: v.ok + v.nok ? v.ok / (v.ok + v.nok) : null,
      })),
  };
}

/** Todas as tags de CS/CX do período — mostra o funil da pesquisa, não só o placar. */
async function tagsDeCx(filtros) {
  const { rows } = await query(
    `select tag, count(*) n from ${ATENDIMENTO}
      where entry_at >= ? and entry_at < ? and (tag like '%CS\\_%' or tag like '%CX%')
      group by tag`,
    [filtros.de, filtros.ate],
  );
  const conta = new Map();
  for (const r of rows) {
    for (const t of separarTags(r.tag)) {
      if (ehTagCx(t)) conta.set(t, (conta.get(t) || 0) + num(r.n));
    }
  }
  return [...conta.entries()]
    .map(([chave, n]) => ({ chave, n, resultado: ehTagCxOk(chave) ? 'ok' : ehTagCxNok(chave) ? 'nok' : null }))
    .sort((a, b) => b.n - a.n);
}

/**
 * Cruza cada disparo de CX com o atendimento que ele gerou e com a resposta.
 *
 * O cruzamento é feito em MEMÓRIA, e isso é decisão de desempenho, não de
 * preguiça: casar por telefone exige normalizar os dois lados (um guarda
 * `5551984360092`, o outro pode vir sem país), e um `regexp_replace` dos dois
 * lados no SQL vira varredura de 1,6 milhão × os disparos — o teste travou em
 * dez minutos. Aqui são duas consultas indexadas e dois `Map`.
 *
 * A ordem de casamento segue a da app original: protocolo, depois telefone. Ela
 * também tenta `cod_atendimento`, que na base não casa com nada (conferido:
 * zero) — então esse salto foi omitido em vez de copiado.
 */
export async function cxCruzado(filtros, limite = 400) {
  const where = ['data_hora_disparo >= ?', 'data_hora_disparo < ?', 'n8n_flow = ?'];
  const params = [filtros.de, filtros.ate, FLUXO_CX];
  filtroIn('cliente_cidade', filtros.cidade, where, params);

  /**
   * A janela das respostas é mais LARGA que a dos disparos, de propósito: a
   * pesquisa vai 72 h após a instalação e a pessoa responde quando quer. Sem a
   * folga, um disparo do último dia do período apareceria sempre como "sem
   * resposta" — e a taxa de resposta cairia por recorte, não por comportamento.
   */
  const folgaDias = 10;
  const ateComFolga = new Date(new Date(String(filtros.ate).replace(' ', 'T')).getTime() + folgaDias * 864e5);
  const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

  const [disparos, atendimentos] = await Promise.all([
    /**
     * TODOS os disparos do período, sem `limit`.
     *
     * A primeira versão trazia `order by data_hora_disparo desc limit 400`, e o
     * resumo saía enviesado de um jeito difícil de notar: a pesquisa chega 72 h
     * depois da instalação, então os disparos mais recentes são justamente os que
     * ainda não têm resposta. Com o corte nos 400 mais novos, 335 apareciam como
     * "não localizados" e a taxa de resposta media o recorte, não o
     * comportamento — o score dava 93,8% contra os 89,4% reais.
     *
     * Trazer tudo é seguro porque a tabela inteira tem 5.408 linhas; o `limite`
     * agora corta apenas a LISTA devolvida, depois de o resumo estar calculado.
     */
    query(
      `select id, data_hora_disparo, prot_atendimento, cod_atendimento, cliente_nome, telefone,
              cliente_cidade, cliente_bairro, cliente_contrato, status_envio, mensagem_envio, n8n_flow
         from ${CX} where ${where.join(' AND ')}
        order by data_hora_disparo desc`,
      params,
    ),
    // só os atendimentos que interessam: os que têm tag de CS
    query(
      `select protocol_number, phone, tag, entry_at, status
         from ${ATENDIMENTO}
        where entry_at >= ? and entry_at < ? and tag like '%CS\\_CX%'`,
      [filtros.de, iso(ateComFolga)],
    ),
  ]);

  const porProtocolo = new Map();
  const porTelefone = new Map();
  for (const a of atendimentos.rows) {
    const tags = separarTags(a.tag);
    const registro = {
      protocolo: a.protocol_number,
      entrada: a.entry_at,
      status: a.status,
      resultado: tags.some(ehTagCxOk) ? 'ok' : tags.some(ehTagCxNok) ? 'nok' : 'semresposta',
    };
    const p = soDigitos(a.protocol_number);
    if (p && !porProtocolo.has(p)) porProtocolo.set(p, registro);
    for (const k of chavesDeTelefone(a.phone)) {
      if (!porTelefone.has(k)) porTelefone.set(k, registro);
    }
  }

  /**
   * Um atendimento só conta uma vez. Dois disparos para o mesmo cliente casam com
   * a mesma resposta, e contar as duas infla o número de respostas — é o mesmo
   * cuidado do `primeiro` na app original.
   */
  const usados = new Set();

  const itens = disparos.rows.map((d) => {
    const p = soDigitos(d.prot_atendimento);
    let achado = p ? porProtocolo.get(p) : null;
    let via = achado ? 'protocolo' : null;
    if (!achado) {
      for (const k of chavesDeTelefone(d.telefone)) {
        const r = porTelefone.get(k);
        if (r) { achado = r; via = 'telefone'; break; }
      }
    }
    const primeiro = achado ? !usados.has(achado) : false;
    if (achado) usados.add(achado);

    return {
      disparadoEm: d.data_hora_disparo,
      protocolo: d.prot_atendimento || null,
      cliente: d.cliente_nome,
      telefone: d.telefone,
      cidade: d.cliente_cidade || '(sem cidade)',
      bairro: d.cliente_bairro || '(sem bairro)',
      contrato: d.cliente_contrato,
      fluxo: d.n8n_flow,
      gerado: num(d.status_envio) === 1,
      retorno: d.mensagem_envio,
      ...separarErro(d.mensagem_envio, num(d.status_envio) === 1),
      via,
      // `primeiro` distingue a resposta nova da repetida; a tela soma só as novas
      resposta: achado ? achado.resultado : 'naoachado',
      primeira: primeiro,
    };
  });

  // o resumo é de TODOS os disparos do período; a lista é que vem cortada
  const respondidos = itens.filter((i) => i.primeira && (i.resposta === 'ok' || i.resposta === 'nok'));
  const ok = respondidos.filter((i) => i.resposta === 'ok').length;
  const gerados = itens.filter((i) => i.gerado).length;

  /**
   * Disparo recente ainda não teve tempo de virar resposta: a pesquisa vai 72 h
   * depois. Contá-lo como "não respondeu" pune o período por ser recente, então
   * a taxa de resposta usa como base só os disparos maduros — e a tela informa
   * quantos ficaram de fora por isso.
   */
  const agora = Date.now();
  const maduro = (i) => agora - new Date(i.disparadoEm).getTime() > 72 * 3600e3;
  const gerardosMaduros = itens.filter((i) => i.gerado && maduro(i)).length;
  const aguardando = gerados - gerardosMaduros;

  return {
    itens: itens.slice(0, limite),
    resumo: {
      disparos: itens.length,
      gerados,
      erros: itens.length - gerados,
      localizados: itens.filter((i) => i.via).length,
      porProtocolo: itens.filter((i) => i.via === 'protocolo').length,
      porTelefone: itens.filter((i) => i.via === 'telefone').length,
      respostas: respondidos.length,
      ok,
      nok: respondidos.length - ok,
      score: respondidos.length ? ok / respondidos.length : null,
      taxaResposta: gerardosMaduros ? respondidos.length / gerardosMaduros : null,
      aguardandoJanela: aguardando,
      cidades: new Set(itens.map((i) => i.cidade)).size,
      primeiro: itens.length ? itens[itens.length - 1].disparadoEm : null,
      ultimo: itens.length ? itens[0].disparadoEm : null,
      mostrando: Math.min(itens.length, limite),
      truncado: itens.length > limite,
    },
    /**
     * Motivos de erro agrupados pelo par código HTTP + `cod_error` (ver
     * `separarErro`), e não pelo texto: o n8n mudou o formato da mensagem no meio
     * do histórico, e agrupar pelo texto parte o mesmo erro em dois.
     */
    erros: (() => {
      const grupos = new Map();
      for (const i of itens) {
        if (i.gerado) continue;
        const chave = i.chaveErro || 'sem-codigo';
        if (!grupos.has(chave)) {
          grupos.set(chave, { id: chave, chave: i.motivoErro || '(sem retorno)', n: 0, codigos: new Set() });
        }
        const g = grupos.get(chave);
        g.n += 1;
        if (i.codigoErro) g.codigos.add(i.codigoErro);
      }
      return [...grupos.values()]
        .map((g) => ({ id: g.id, chave: g.chave, n: g.n, codigos: [...g.codigos] }))
        .sort((a, b) => b.n - a.n);
    })(),
  };
}

/**
 * Separa o código e o motivo do erro na mensagem de retorno do disparo.
 *
 * Duas coisas o dado real exigiu:
 *
 * 1. As falhas vêm como `400 - {"cod_error":13,"msg":"Contato possui atendimento
 *    ativo"}`. Agrupar pela mensagem inteira criaria um grupo por cliente,
 *    porque o corpo às vezes traz o número dele.
 * 2. O MESMO erro aparece em DUAS grafias, porque o n8n mudou o formato em algum
 *    momento: `400 - "{\"cod_error\":13,...}"` e `[400 - cod_error 13] Contato
 *    possui atendimento ativo`. Agrupando pelo texto, o mesmo problema aparecia
 *    duas vezes com contagens partidas (105 e 9). Por isso a chave de
 *    agrupamento é o par código HTTP + `cod_error`, que sobrevive às duas.
 */
function separarErro(mensagem, sucesso) {
  if (sucesso) return { codigoErro: null, motivoErro: null, chaveErro: null };
  const texto = String(mensagem || '').trim();
  if (!texto) return { codigoErro: null, motivoErro: '(sem retorno)', chaveErro: 'sem-retorno' };

  /**
   * Os regex toleram a barra de escape porque o JSON chega ESCAPADO no campo:
   * o texto literal é `400 - "{\"cod_error\":13,\"msg\":\"...\"}"`, com as
   * barras fazendo parte do valor. Sem o `\\?` a busca por `"cod_error"` não
   * casava e todo erro caía no grupo genérico do código HTTP.
   */
  const http = /(\d{3})/.exec(texto)?.[1] || null;
  /**
   * Os dois-pontos são OPCIONAIS porque as duas grafias escrevem diferente: o
   * JSON usa `\"cod_error\":13` e a versão nova usa `[400 - cod_error 13]`, com
   * espaço. Exigindo `:`, a segunda caía no grupo genérico `400` e o mesmo erro
   * ficava partido em dois — 124 numa linha e 9 na outra.
   */
  const cod = /cod_error\\?"?\s*:?\s*(\d+)/i.exec(texto)?.[1] || null;
  // a frase legível está em `msg`, em `message`, ou depois do `]` na grafia nova
  const msg = /\\?"(?:msg|message)\\?"\s*:\s*\\?"([^"\\]+)/i.exec(texto)?.[1]
    || /\]\s*(.+)$/s.exec(texto)?.[1]
    || texto.replace(/^\s*\d{3}\s*[-:]?\s*/, '');

  return {
    codigoErro: http,
    motivoErro: String(msg).replace(/\\"/g, '"').replace(/[{}"\\]+$/, '').trim().slice(0, 160) || '(sem detalhe)',
    chaveErro: [http, cod].filter(Boolean).join('/') || 'sem-codigo',
  };
}

export async function detalhamentoCx(filtros, limite = 500) {
  const where = ['data_hora_disparo >= ?', 'data_hora_disparo < ?', 'n8n_flow = ?'];
  const params = [filtros.de, filtros.ate, FLUXO_CX];
  filtroIn('cliente_cidade', filtros.cidade, where, params);
  const { rows } = await query(
    `select data_hora_disparo, prot_atendimento, cliente_nome, cliente_cidade, cliente_bairro,
            cliente_contrato, status_envio, mensagem_envio, n8n_flow
       from ${CX} where ${where.join(' AND ')}
      order by data_hora_disparo desc limit ?`,
    [...params, limite],
  );
  return rows;
}

// --------------------------------------------------- DISPAROS (n8n × Meta)

/**
 * As duas metades do envio de HSM, que vivem em tabelas diferentes:
 *
 *   DISPARO — `DB_Applicattion.matrix_hsm_cx_post_installation`, alimentada pelo
 *   n8n. Responde "a automação conseguiu pedir o envio?". O `status_envio` é o
 *   retorno da API do MatrixGO na hora do disparo: 1 quando o atendimento foi
 *   gerado, 0 quando falhou (token inválido, contato já com atendimento aberto).
 *
 *   META — `API_WebDeveloper.db_matrix_hsms_enviados`, que é o relatório do
 *   MatrixGO/Meta. Responde "a mensagem chegou e foi lida?". Aqui os status são
 *   Enviada → Entregue → Lida, mais os motivos de não entrega.
 *
 * São etapas em sequência, não visões alternativas do mesmo número: o n8n dispara
 * e a Meta entrega. Um disparo com sucesso pode não ser entregue, e a Meta reporta
 * MUITO mais do que o n8n dispara — em 30 dias, 24.663 contra 5.417, porque ela
 * cobre todo HSM da conta (inclusive o que sai da mão de um atendente) e o n8n só
 * as automações dele.
 *
 * A reconciliação liga as duas por `protocol_number`. Medido em 08/09/2026: 63%
 * dos disparos aparecem no relatório da Meta, e no fluxo de CX a taxa é de 82,6%.
 * O que não casa não é necessariamente perda — pode ser disparo que falhou antes
 * de gerar mensagem, ou protocolo que a Meta registrou sob outro número.
 */
export async function disparos(filtros) {
  const ondeN8n = ['data_hora_disparo >= ?', 'data_hora_disparo < ?'];
  const pN8n = [filtros.de, filtros.ate];
  filtroIn('n8n_flow', filtros.fluxo, ondeN8n, pN8n);
  const n8n = ondeN8n.join(' AND ');

  /**
   * A RECONCILIAÇÃO É FEITA EM MEMÓRIA, e não com um join no banco.
   *
   * Nenhuma das duas tabelas tem índice em `protocol_number` — conferido com
   * `show index`: a de HSM indexa `report_date`, `message_id` e
   * `interaction_id`, e a do n8n só a chave primária. Sem índice, o
   * `left join ... on h.protocol_number = c.prot_atendimento` é uma varredura
   * por linha e estoura o `max_statement_time` do servidor; foi o que aconteceu
   * na primeira versão desta função.
   *
   * As duas consultas separadas custam 507 ms no total (145 ms dos disparos,
   * 352 ms dos HSMs do período, 10 ms de junção) e são O(n+m). É a mesma escolha
   * de `cxCruzado`, pelo mesmo motivo — vale como regra para estas tabelas.
   */
  const [porFluxo, porDia, erros, total, disparosCrus, hsmsDoPeriodo] = await Promise.all([
    query(`select n8n_flow fluxo, count(*) disparos,
                  sum(case when status_envio = 1 then 1 else 0 end) sucesso,
                  count(distinct nullif(cliente_cidade, '')) cidades,
                  min(data_hora_disparo) primeiro, max(data_hora_disparo) ultimo
             from ${CX} where ${n8n} group by fluxo order by disparos desc`, pN8n),
    query(`select date(data_hora_disparo) dia, count(*) disparos,
                  sum(case when status_envio = 1 then 1 else 0 end) sucesso
             from ${CX} where ${n8n} group by dia order by dia`, pN8n),
    /**
     * 240 caracteres, e não 80: o retorno é um JSON escapado
     * (`400 - "{\"cod_error\":13,\"msg\":\"...\"}"`) e cortar em 80 decepava o
     * corpo ANTES do campo `msg`. O agrupamento por código passava a ver apenas
     * `400`, sem o `cod_error`, e a frase legível saía como `}`. A coluna é
     * varchar(500), então 240 cobre o retorno inteiro dos erros conhecidos.
     */
    query(`select left(coalesce(nullif(mensagem_envio, ''), '(sem retorno)'), 240) motivo,
                  n8n_flow fluxo, count(*) n
             from ${CX} where ${n8n} and status_envio <> 1
            group by motivo, fluxo order by n desc limit 30`, pN8n),
    query(`select count(*) disparos, sum(case when status_envio = 1 then 1 else 0 end) sucesso
             from ${CX} where ${n8n}`, pN8n),
    query(`select n8n_flow fluxo, prot_atendimento protocolo from ${CX} where ${n8n}`, pN8n),
    /**
     * A janela do lado da Meta é a MESMA do disparo, mais uma folga de dois dias:
     * o relatório dela é diário e a mensagem disparada às 23h de um dia aparece no
     * `report_date` do dia seguinte. Sem a folga, os disparos do fim do período
     * apareceriam como "não confirmados pela Meta" por questão de fuso do
     * relatório, não por falha de entrega.
     */
    query(`select protocol_number protocolo, status, template_name template, category categoria
             from ${HSM}
            where report_date >= ? and report_date <= date_add(?, interval 2 day)
              and protocol_number is not null and protocol_number <> ''`,
    [soData(filtros.de), soData(filtros.ateInclusivo)]),
  ]);

  const t = total.rows[0] || {};
  const disparosTotal = num(t.disparos) || 0;
  const sucesso = num(t.sucesso) || 0;
  const taxa = (a, b) => (b ? a / b : null);

  // protocolo -> mensagens que a Meta registrou para ele
  const metaPorProtocolo = new Map();
  for (const h of hsmsDoPeriodo.rows) {
    const p = String(h.protocolo);
    if (!metaPorProtocolo.has(p)) metaPorProtocolo.set(p, []);
    metaPorProtocolo.get(p).push(h);
  }

  const recPorFluxo = new Map();
  const templatesPorFluxo = new Map();
  for (const d of disparosCrus.rows) {
    const fluxo = d.fluxo || '(sem fluxo)';
    if (!recPorFluxo.has(fluxo)) recPorFluxo.set(fluxo, { na_meta: 0, entregues: 0, lidas: 0 });
    const r = recPorFluxo.get(fluxo);
    const mensagens = metaPorProtocolo.get(String(d.protocolo || ''));
    if (!mensagens?.length) continue;
    r.na_meta += 1;
    if (mensagens.some((m) => m.status === 'Lida')) r.lidas += 1;
    if (mensagens.some((m) => m.status === 'Lida' || m.status === 'Entregue')) r.entregues += 1;
    for (const m of mensagens) {
      const chave = `${fluxo}|${m.template}|${m.categoria || ''}`;
      templatesPorFluxo.set(chave, (templatesPorFluxo.get(chave) || 0) + 1);
    }
  }

  return {
    kpis: {
      disparos: disparosTotal,
      sucesso,
      erros: disparosTotal - sucesso,
      taxaSucesso: taxa(sucesso, disparosTotal),
      fluxos: porFluxo.rows.length,
      naMeta: [...recPorFluxo.values()].reduce((s, r) => s + r.na_meta, 0),
    },
    porFluxo: porFluxo.rows.map((r) => {
      const rec = recPorFluxo.get(r.fluxo) || {};
      const d = num(r.disparos);
      return {
        chave: r.fluxo || '(sem fluxo)',
        disparos: d,
        sucesso: num(r.sucesso),
        erros: d - num(r.sucesso),
        taxaSucesso: taxa(num(r.sucesso), d),
        cidades: num(r.cidades),
        naMeta: rec.na_meta || 0,
        entregues: rec.entregues || 0,
        lidas: rec.lidas || 0,
        taxaReconciliacao: taxa(rec.na_meta || 0, d),
        ehCx: r.fluxo === FLUXO_CX,
        primeiro: r.primeiro,
        ultimo: r.ultimo,
      };
    }),
    porDia: porDia.rows.map((r) => ({
      periodo: soData(r.dia), label: rotuloDia(soData(r.dia)),
      disparos: num(r.disparos), sucesso: num(r.sucesso),
      erros: num(r.disparos) - num(r.sucesso),
    })),
    /**
     * Erros agrupados pelo par código HTTP + `cod_error`, e não pela mensagem.
     *
     * A consulta agrupa por (motivo, fluxo), então o mesmo erro chega repetido —
     * uma vez por fluxo, e às vezes duas no mesmo fluxo por causa da mudança de
     * formato da mensagem. Aqui isso colapsa: um item por problema real, com a
     * lista de fluxos em que ele apareceu.
     */
    erros: (() => {
      const grupos = new Map();
      for (const r of erros.rows) {
        const info = separarErro(r.motivo, false);
        const chave = info.chaveErro;
        if (!grupos.has(chave)) {
          grupos.set(chave, { id: chave, chave: info.motivoErro, codigoErro: info.codigoErro, n: 0, fluxos: new Set() });
        }
        const g = grupos.get(chave);
        g.n += num(r.n);
        if (r.fluxo) g.fluxos.add(r.fluxo);
      }
      return [...grupos.values()]
        .map((g) => ({ ...g, fluxos: [...g.fluxos], pct: taxa(g.n, disparosTotal - sucesso) }))
        .sort((a, b) => b.n - a.n);
    })(),
    /**
     * Qual template da Meta cada automação usa — o mapa entre os dois relatórios.
     *
     * Um disparo pode casar com mais de um template porque o mesmo protocolo
     * recebe outras mensagens (uma segunda via, um carnê) além da do fluxo. Por
     * isso a lista é ordenada por volume: o primeiro de cada fluxo é o template
     * daquela automação, os demais são o que mais chegou àquele cliente.
     */
    templates: [...templatesPorFluxo.entries()]
      .map(([chave, n]) => {
        const [fluxo, template, categoria] = chave.split('|');
        return { fluxo, chave: template, categoria: categoria || null, n };
      })
      .sort((a, b) => b.n - a.n)
      .slice(0, 40),
    fluxoCx: FLUXO_CX,
  };
}

// ------------------------------------------------------------------- filtros

export async function filtrosDisponiveis(filtros) {
  const dias = [soData(filtros.de), soData(filtros.ateInclusivo)];
  const [status, canal, template, categoria, fluxo, cidade] = await Promise.all([
    query(`select distinct status v from ${ATENDIMENTO} where report_date >= ? and report_date <= ? and status <> '' order by v`, dias),
    query(`select distinct channel v from ${ATENDIMENTO} where report_date >= ? and report_date <= ? and channel <> '' order by v`, dias),
    query(`select distinct template_name v from ${HSM} where report_date >= ? and report_date <= ? and template_name <> '' order by v`, dias),
    query(`select distinct category v from ${HSM} where report_date >= ? and report_date <= ? and category <> '' order by v`, dias),
    query(`select distinct n8n_flow v from ${CX} where data_hora_disparo >= ? and data_hora_disparo < ? and n8n_flow <> '' order by v`, [filtros.de, filtros.ate]),
    // cidade só do fluxo de CX: é a única tela que filtra por cidade, e os outros
    // fluxos não preenchem o campo — a lista viria com as opções de um fluxo que
    // aquela tela não mostra
    query(`select distinct cliente_cidade v from ${CX}
            where data_hora_disparo >= ? and data_hora_disparo < ? and cliente_cidade <> '' and n8n_flow = ?
            order by v`, [filtros.de, filtros.ate, FLUXO_CX]),
  ]);
  return {
    status: status.rows.map((r) => r.v),
    canal: canal.rows.map((r) => r.v),
    ativoReceptivo: ['Receptivo', 'Ativo'],
    template: template.rows.map((r) => r.v),
    categoria: categoria.rows.map((r) => r.v),
    fluxo: fluxo.rows.map((r) => r.v),
    cidade: cidade.rows.map((r) => r.v),
  };
}
