# CSAT Native: pesquisa da URA (relatório 107)

A tela **Geral · CSAT Native** lê `API_WebDeveloper.db_native_avaliations`, filtrando
`origem = 'native_relatorio_107'`. Quem alimenta a tabela é o fluxo n8n `apis_nativeinfinity`
(`l4wyPQWgI3QDSVAD`), a cada 15 min, pelo ramo `get_csat → csat_sql → insert_csat`.

| Arquivo | O que é |
|---|---|
| `001_db_native_avaliations_relatorio_107.sql` | Migração da tabela, aplicada em 06/11/2026. O comentário do arquivo traz o mapeamento das colunas e o SQL para voltar. |
| `n8n-csat-sql.js` | Corpo do nó Code `csat_sql`. **É a fonte**: o que está no n8n é cópia dele. |
| `carga-historica.mjs` | Carga mês a mês. Roda o mesmo código do nó, é idempotente e só grava com `--aplicar`. |

## O relatório 107

- Uma linha por **perna** de ligação, com `Nota1`, `Nota2` e `Nota3`. Desde 01/09/2026 só a `Nota1`
  vem preenchida, de 1 a 5, em ~10% das ligações. Antes disso não há nota.
- Em transferência, a mesma nota aparece em cada perna (ramal e agente diferentes). A chave
  única inclui o `ramal`, e a tela conta resposta por (protocolo, pergunta) distintos.
- `Data/Hora` é o início da ligação. A API não informa a hora da resposta.
- Filtro de data: `DATE_SUB(startTime, INTERVAL 3 HOUR)`, em hora local, igual aos relatórios
  97, 100 e 21 do mesmo fluxo. Janela do fluxo: ontem 00:00 até hoje 23:59:59 (`inicioCsat`).

## Medidas (mesma régua do CSAT Matrix)

- **Nota CSAT** = respostas com nota 3, 4 ou 5 ÷ respostas (`#matrix_csat_note`).
- **Adesão** = protocolos avaliados ÷ ligações atendidas, ou seja `db_native` com
  `perdida` nula (`#matrix_membership_fee` sobre `#native_completed_services`).

## Linhas antigas

As 44 linhas de 01 a 04/12/2025 vieram da pesquisa 20 do **MatrixGO** (WhatsApp), pelo ramo
`get_pesquisa_native` do fluxo `apis_matrixgo`. Ficaram na tabela com `origem = 'matrix_pesquisa_20'`
(o DEFAULT da coluna, então o que esse ramo ainda gravar sai marcado assim) e não entram na tela.
