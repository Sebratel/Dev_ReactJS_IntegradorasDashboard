import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { assertEscritaPermitida } from '../core/guard.js';

/**
 * Conexão de ESCRITA do MariaDB, usada só pela aba Pesos das Configurações.
 *
 * Fica fora do `maria.js` de propósito: aquele pool continua somente-leitura (usuário
 * de leitura + `assertReadOnly`), e este só existe quando DB_PESOS_USER está definido.
 * O usuário de banco deve ter apenas SELECT e UPDATE em
 * DB_Technical_Support.workloads_quartiles; além disso, `assertEscritaPermitida`
 * recusa qualquer comando que não seja o UPDATE do peso.
 */
let pool = null;

export const escritaHabilitada = () => Boolean(config.pesos.user);

function obterPool() {
  if (!escritaHabilitada()) throw new Error('Escrita dos pesos desligada: defina DB_PESOS_USER e DB_PESOS_PASSWORD.');
  if (!pool) {
    pool = mysql.createPool({
      host: config.maria.host,
      port: config.maria.port,
      user: config.pesos.user,
      password: config.pesos.password,
      waitForConnections: true,
      connectionLimit: 2,
      connectTimeout: 15000,
      charset: 'utf8mb4',
    });
  }
  return pool;
}

/**
 * Roda várias escritas numa transação só: ou todos os pesos mudam, ou nenhum. Um
 * salvamento pela metade deixaria a nota final calculada com metade da regra nova.
 */
export async function emTransacao(comandos) {
  for (const { sql } of comandos) assertEscritaPermitida(sql);
  const conn = await obterPool().getConnection();
  try {
    await conn.beginTransaction();
    const afetadas = [];
    for (const { sql, params } of comandos) {
      const [r] = await conn.query(sql, params);
      afetadas.push(r.affectedRows);
    }
    await conn.commit();
    return afetadas;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}
