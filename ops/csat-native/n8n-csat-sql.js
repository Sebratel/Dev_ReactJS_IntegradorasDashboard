// Corpo do nó Code `csat_sql` do fluxo n8n apis_nativeinfinity (l4wyPQWgI3QDSVAD).
// Modo "Run Once for All Items". Este arquivo é a fonte: o que está no n8n é cópia
// dele, e a carga histórica (carga-historica.mjs) roda exatamente este código.
//
// Entrada: a resposta do relatório 107 da Native (`body.data`), uma linha por PERNA
// de ligação com Nota1, Nota2 e Nota3. Saída: UM item com o INSERT pronto de todas
// as notas preenchidas, ou nenhum item quando não há nota (o ramo termina aí).
//
// Por que montar o SQL aqui: nesta instância o nó MySQL não vincula parâmetros "?",
// então o valor vai interpolado e o escape é nosso: dobrar a aspa simples e a barra
// invertida, que é o escape de literal do MySQL. A query sai numa linha só, porque
// o nó MySQL apaga as quebras de linha sem pôr espaço no lugar.

const NOTAS = ['Nota1', 'Nota2', 'Nota3'];

const texto = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s.toLowerCase() === 'null' ? null : s;
};
const sql = (v) => (v === null || v === undefined
  ? 'NULL'
  : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`);

// "05/11/2026 07:27:38" -> "2026-11-05 07:27:38" (hora local, como no db_native)
const dataIso = (v) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})$/.exec(String(v ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}` : null;
};

const valores = [];
for (const item of $input.all()) {
  const linhas = item.json?.body?.data;
  if (!Array.isArray(linhas)) continue;

  for (const r of linhas) {
    const protocolo = String(r.Protocolo ?? '').trim();
    const data = dataIso(r['Data/Hora']);
    // protocolo vira cod_atendimento (bigint): só dígitos, e sem data não há período
    if (!/^\d{1,18}$/.test(protocolo) || !data) continue;

    for (const pergunta of NOTAS) {
      const nota = texto(r[pergunta]);
      if (!nota || !/^\d{1,2}$/.test(nota)) continue;
      valores.push(`('native_relatorio_107', ${protocolo}, ${sql(pergunta)}, ${sql(data)}, `
        + `${sql(texto(r['Número']))}, ${sql(nota)}, ${sql(protocolo)}, ${sql(texto(r.Agente))}, 'URA', `
        + `${sql(texto(r.Ramal) ?? '')}, ${sql(texto(r.Fila))}, ${sql(texto(r.Sentido))}, ${sql(texto(r['Desconexão']))})`);
    }
  }
}

if (!valores.length) return [];

const query = 'INSERT INTO db_native_avaliations '
  + '(origem, cod_atendimento, nom_pergunta, dat_resposta, num_telefone, nom_valor, num_protocolo, '
  + 'nom_agente, nom_tipo_integracao, ramal, fila, sentido, desconexao) '
  + `VALUES ${valores.join(', ')} `
  + 'ON DUPLICATE KEY UPDATE dat_resposta = VALUES(dat_resposta), num_telefone = VALUES(num_telefone), '
  + 'nom_valor = VALUES(nom_valor), nom_agente = VALUES(nom_agente), fila = VALUES(fila), '
  + 'sentido = VALUES(sentido), desconexao = VALUES(desconexao)';

return [{ json: { query, notas: valores.length } }];
