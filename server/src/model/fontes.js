/**
 * Frescor das bases que alimentam o dashboard — o que a CAPA mostra.
 *
 * A capa do `comercial_pbi` traz o estado de cada fonte e há quanto tempo ela foi
 * lida; lá isso é grátis, porque um ETL guarda o horário de cada carga. Aqui não
 * existe ETL, então a pergunta equivalente é outra: **até quando cada base tem
 * dado**. É até melhor como resposta — mostra a defasagem real da origem, não a
 * hora em que alguém copiou.
 *
 * Cada consulta é um `max()` sobre a coluna de data. Uma falha em qualquer uma
 * NÃO derruba a capa: a fonte aparece marcada como indisponível, e é assim que a
 * pessoa descobre que a base parou em vez de achar que o número está errado.
 * (A base de CSAT do Native, por exemplo, ficou parada de 04/12/2025 até a troca
 * para o relatório 107 em 06/11/2026 — foi por aqui que esse fato aparecia na capa.)
 */
import { query } from '../db/maria.js';

const FONTES = [
  {
    id: 'matrix',
    nome: 'Atendimentos MatrixGO',
    relatorio: 'Geral · Suporte',
    sql: 'select max(data_atendimento) u from API_WebDeveloper.db_matrix',
  },
  {
    id: 'native',
    nome: 'Atendimentos Native Infinity',
    relatorio: 'Geral · Suporte',
    sql: 'select max(data_hora) u from API_WebDeveloper.db_native',
  },
  {
    id: 'csatMatrix',
    nome: 'Avaliações CSAT (Matrix)',
    relatorio: 'Geral',
    sql: 'select max(dat_resposta) u from API_WebDeveloper.db_matrix_avaliations',
  },
  {
    // Pesquisa da URA (relatório 107), gravada pelo n8n a cada 15 min. A tabela
    // guarda também 44 linhas antigas da pesquisa do Matrix (dez/2025): sem filtrar
    // a origem, a capa mediria a fonte errada.
    id: 'csatNative',
    nome: 'Avaliações CSAT (Native)',
    relatorio: 'Geral',
    sql: "select max(dat_resposta) u from API_WebDeveloper.db_native_avaliations where origem = 'native_relatorio_107'",
  },
  {
    id: 'atendimentoAnalitico',
    nome: 'Analítico de atendimento',
    relatorio: 'Analíticos',
    sql: 'select max(entry_at) u from API_WebDeveloper.db_matrix_atendimento_analitico',
  },
  {
    id: 'hsm',
    nome: 'Mensagens HSM',
    relatorio: 'Analíticos',
    sql: 'select max(report_date) u from API_WebDeveloper.db_matrix_hsms_enviados',
  },
  {
    id: 'cx',
    nome: 'CX pós-instalação',
    relatorio: 'Analíticos',
    sql: 'select max(data_hora_disparo) u from DB_Applicattion.matrix_hsm_cx_post_installation',
  },
];

export async function fontes() {
  const resultados = await Promise.all(FONTES.map(async (f) => {
    try {
      const { rows } = await query(f.sql);
      const bruto = rows[0]?.u ?? null;
      // as colunas de data do db_matrix são VARCHAR; as demais são DATETIME. O
      // `String()` normaliza as duas para 'YYYY-MM-DD HH:MM:SS' sem passar por
      // toISOString(), que deslocaria para UTC — as bases guardam hora local.
      const ultimo = bruto
        ? String(bruto instanceof Date
          ? `${bruto.getFullYear()}-${String(bruto.getMonth() + 1).padStart(2, '0')}-${String(bruto.getDate()).padStart(2, '0')}`
            + ` ${String(bruto.getHours()).padStart(2, '0')}:${String(bruto.getMinutes()).padStart(2, '0')}:${String(bruto.getSeconds()).padStart(2, '0')}`
          : bruto)
        : null;
      return { id: f.id, nome: f.nome, relatorio: f.relatorio, ultimo, erro: null };
    } catch (err) {
      console.warn(`[fontes] ${f.id}: ${err.message}`);
      return { id: f.id, nome: f.nome, relatorio: f.relatorio, ultimo: null, erro: 'indisponível' };
    }
  }));
  return resultados;
}
