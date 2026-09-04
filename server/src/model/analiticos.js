import { query } from '../db/maria.js';

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

  const [porStatus, porDia, porHora, porCanal, porFila, tempos] = await Promise.all([
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
  ]);

  const total = porStatus.rows.reduce((s, r) => s + num(r.n), 0);
  const de = (nome) => num(porStatus.rows.find((r) => r.status === nome)?.n) || 0;

  return {
    kpis: {
      total,
      finalizados: de('Finalizado'),
      inatividade: de('Finalizado por inatividade'),
      automatico: de('Automático'),
      transferidos: de('Transferido') + de('Transferido Pendência - Fila Prioritária'),
      emPesquisa: de('Em pesquisa'),
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
                  sum(case when status in ('Lida','Entregue') then 1 else 0 end) entregues
             from ${HSM} where ${onde} group by dia order by dia`, params),
    query(`select template_name, category, count(*) enviadas,
                  sum(case when status = 'Lida' then 1 else 0 end) lidas,
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

  return {
    kpis: { enviadas, entregues, lidas, falhas, taxaEntrega: enviadas ? entregues / enviadas : null },
    // "motivo da falha" aqui é o próprio status: é assim que a plataforma reporta
    // (ex.: "A Meta decidiu não entregar a mensagem")
    falhas: porStatus.rows
      .filter((r) => !HSM_OK.includes(r.status))
      .map((r) => ({ chave: r.status || '(sem status)', n: num(r.n) })),
    porStatus: porStatus.rows.map((r) => ({ chave: r.status || '(sem status)', n: num(r.n) })),
    porDia: porDia.rows.map((r) => ({
      periodo: soData(r.dia), label: rotuloDia(soData(r.dia)),
      enviadas: num(r.enviadas), entregues: num(r.entregues), lidas: num(r.lidas),
    })),
    porTemplate: porTemplate.rows.map((r) => ({
      chave: r.template_name, categoria: r.category, enviadas: num(r.enviadas),
      lidas: num(r.lidas), falhas: num(r.falhas),
      taxaLeitura: num(r.enviadas) ? num(r.lidas) / num(r.enviadas) : null,
    })),
    porCategoria: porCategoria.rows.map((r) => ({ chave: r.categoria, n: num(r.n) })),
  };
}

// ------------------------------------------------------------------------ CX

/**
 * A tabela não é só de pós-instalação: guarda três fluxos do n8n (cobrança com 6
 * dias de atraso, o CX de 72h após a instalação e a verificação de sinal depois de
 * massiva). Por isso o fluxo é um filtro da tela, e não uma suposição.
 */
export async function cx(filtros) {
  const where = ['data_hora_disparo >= ?', 'data_hora_disparo < ?'];
  const params = [filtros.de, filtros.ate];
  filtroIn('n8n_flow', filtros.fluxo, where, params);
  filtroIn('cliente_cidade', filtros.cidade, where, params);
  const onde = where.join(' AND ');

  const [porDia, porFluxo, porCidade, porMensagem, total] = await Promise.all([
    query(`select date(data_hora_disparo) dia, count(*) disparos,
                  sum(case when status_envio = 1 then 1 else 0 end) sucesso
             from ${CX} where ${onde} group by dia order by dia`, params),
    query(`select n8n_flow fluxo, count(*) disparos,
                  sum(case when status_envio = 1 then 1 else 0 end) sucesso
             from ${CX} where ${onde} group by fluxo order by disparos desc`, params),
    query(`select coalesce(nullif(cliente_cidade, ''), '(sem cidade)') cidade, count(*) disparos,
                  sum(case when status_envio = 1 then 1 else 0 end) sucesso
             from ${CX} where ${onde} group by cidade order by disparos desc limit 25`, params),
    // a mensagem de retorno é o "motivo": sucesso vem como texto, falha vem com o
    // código HTTP e o corpo do erro, que fica longo — o corte deixa o motivo legível
    query(`select left(coalesce(nullif(mensagem_envio, ''), '(sem retorno)'), 70) motivo,
                  count(*) n, status_envio
             from ${CX} where ${onde} group by motivo, status_envio order by n desc limit 20`, params),
    query(`select count(*) disparos, sum(case when status_envio = 1 then 1 else 0 end) sucesso,
                  count(distinct cliente_contrato) contratos
             from ${CX} where ${onde}`, params),
  ]);

  const t = total.rows[0] || {};
  const disparos = num(t.disparos) || 0;
  const sucesso = num(t.sucesso) || 0;

  return {
    kpis: {
      disparos,
      sucesso,
      falha: disparos - sucesso,
      contratos: num(t.contratos) || 0,
      taxaSucesso: disparos ? sucesso / disparos : null,
    },
    porDia: porDia.rows.map((r) => ({
      periodo: soData(r.dia), label: rotuloDia(soData(r.dia)),
      disparos: num(r.disparos), sucesso: num(r.sucesso),
      falha: num(r.disparos) - num(r.sucesso),
    })),
    porFluxo: porFluxo.rows.map((r) => ({
      chave: r.fluxo || '(sem fluxo)', disparos: num(r.disparos), sucesso: num(r.sucesso),
      taxa: num(r.disparos) ? num(r.sucesso) / num(r.disparos) : null,
    })),
    porCidade: porCidade.rows.map((r) => ({
      chave: r.cidade, disparos: num(r.disparos), sucesso: num(r.sucesso),
      taxa: num(r.disparos) ? num(r.sucesso) / num(r.disparos) : null,
    })),
    porMensagem: porMensagem.rows.map((r) => ({
      chave: r.motivo, n: num(r.n), sucesso: num(r.status_envio) === 1,
    })),
  };
}

export async function detalhamentoCx(filtros, limite = 500) {
  const where = ['data_hora_disparo >= ?', 'data_hora_disparo < ?'];
  const params = [filtros.de, filtros.ate];
  filtroIn('n8n_flow', filtros.fluxo, where, params);
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

// ------------------------------------------------------------------- filtros

export async function filtrosDisponiveis(filtros) {
  const dias = [soData(filtros.de), soData(filtros.ateInclusivo)];
  const [status, canal, template, categoria, fluxo, cidade] = await Promise.all([
    query(`select distinct status v from ${ATENDIMENTO} where report_date >= ? and report_date <= ? and status <> '' order by v`, dias),
    query(`select distinct channel v from ${ATENDIMENTO} where report_date >= ? and report_date <= ? and channel <> '' order by v`, dias),
    query(`select distinct template_name v from ${HSM} where report_date >= ? and report_date <= ? and template_name <> '' order by v`, dias),
    query(`select distinct category v from ${HSM} where report_date >= ? and report_date <= ? and category <> '' order by v`, dias),
    query(`select distinct n8n_flow v from ${CX} where data_hora_disparo >= ? and data_hora_disparo < ? and n8n_flow <> '' order by v`, [filtros.de, filtros.ate]),
    query(`select distinct cliente_cidade v from ${CX} where data_hora_disparo >= ? and data_hora_disparo < ? and cliente_cidade <> '' order by v`, [filtros.de, filtros.ate]),
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
