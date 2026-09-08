# Dev_ReactJS_IntegradorasDashboard

Réplica em React dos relatórios Power BI de Suporte Técnico das Integradoras —
**GERAL · Relatórios Detalhados Integradoras**, **SUP · Indicadores Suporte** e um
terceiro grupo, **Analíticos**, que não vem de Power BI.

14 telas, servidas por uma API própria que lê os bancos em **somente leitura**.

## Telas

| Grupo | Telas |
| --- | --- |
| **GERAL** (`/geral/*`) | Capa, Matrix, CSAT Matrix, Native, CSAT Native, Produtividade, Quartis |
| **SUP** (`/sup/*`) | Capa, Matrix, Native, Report Executivo |
| **Analíticos** (`/analiticos/*`) | Atendimento, Mensagens HSM, CX Pós-Instalação |

GERAL e SUP têm telas de mesmo nome (Capa, Matrix, Native) — daí o alternador de
relatório na barra do topo, e daí o id de tela do controle de acesso ser
prefixado pelo relatório.

## Estrutura

```
web/      Vite + React + Recharts + TanStack Query
server/   Express + pg + mysql2 (JS puro, sem build)
```

Uma imagem só: o Express serve a API **e** o bundle do Vite (`server/public`) na
mesma porta. Não há nginx, proxy nem CORS para configurar no deploy.

## Fontes de dado

**MariaDB** — a conexão abre em `DB_Massives`, mas cada consulta qualifica o banco
na própria SQL. O usuário precisa de `SELECT` em quatro:

| Banco | O que sai de lá |
| --- | --- |
| `API_WebDeveloper` | `db_matrix`, `db_native`, `db_*_avaliations`, `db_*_stops`, `db_senior_collaborators`, `db_matrix_atendimento_analitico`, `db_matrix_hsms_enviados` |
| `DB_Massives` | `massiva_history` (clientes afetados por massiva) |
| `DB_Applicattion` | `matrix_hsm_cx_post_installation` (os 3 fluxos do n8n) |
| `DB_Technical_Support` | `workloads_quartiles` (pesos da nota por quartil) |

**PostgreSQL (elleven / ERP Voalle)** — `erp.*`: massivas, incidentes, contratos
afetados e o cadastro de usuários usado pelo SUP.

**Duas APIs externas** ligam o atendente à identidade: `atendente`/`agente` são
texto livre (`"Ivan Costa - Suporte Técnico"`), sem e-mail — MatrixGO e Native
Infinity são o que fecha essa ponte.

### `db_matrix` e `db_matrix_atendimento_analitico` não são alternativas

As duas tabelas se sobrepõem, mas **nenhuma contém a outra**, e é por isso que as
duas continuam em uso:

- `db_matrix` — 22 colunas, **desde 2021-06**, atualizada **de minuto a minuto**.
  Datas em `varchar(100)`. É o subconjunto **humano**: bate com o analítico
  filtrado em `service_type IN ('Humano','Misto')`.
- `db_matrix_atendimento_analitico` — 52 colunas com `datetime` e índices de
  verdade, **só a partir de 2025-01-01**, carga **diária** (não contínua).
  Traz o que a outra não tem: `recurrence` (rechamada/reincidência),
  `service_type`, `status` legível, durações já calculadas, contagem de mensagens
  — e as conversas **só de robô** (`Automático`, `Notificação`), que são a maior
  parte do volume e simplesmente não existem em `db_matrix`.

Ou seja: GERAL e SUP usam `db_matrix` porque precisam de histórico longo e do dado
do dia; os Analíticos usam a tabela analítica porque precisam de recorrência e do
atendimento automático. Centralizar tudo em `db_matrix` custaria a recorrência, o
robô e o `service_type`; centralizar tudo no analítico custaria 3,5 anos de
histórico e a atualização intradiária.

## Rodar em desenvolvimento

```bash
# 1) dependências
cd server && npm install && cd ../web && npm install && cd ..

# 2) .env — veja .env.example
#    Em desenvolvimento o .env real mora um nível ACIMA deste repositório
#    (native_matrix_Dashboard/.env), para o arquivo com as senhas ficar longe
#    do que é versionado. O servidor procura em cascata; o Vite aponta
#    envDir: '../../' por causa disso.

# 3) dois terminais
cd server && npm run dev     # API em :8091
cd web    && npm run dev     # Vite em :5174, com proxy de /api
```

## Deploy (Portainer)

**Stacks → Add stack → Repository**, apontando para este repositório, arquivo
`docker-compose.yml`. Preencha as variáveis em *Environment variables* — nenhum
segredo mora no repositório.

Front e API sobem juntos na **porta 8091** (8080/8081 são do dashboard comercial).

Três coisas que costumam morder:

1. **As `VITE_FIREBASE_*` são build args, não variáveis de runtime.** Elas entram
   no bundle em tempo de build. Trocar uma delas exige **reconstruir a imagem** —
   reiniciar o container não muda nada.
2. **O volume `/app/data` não é opcional.** É onde ficam papéis, permissões por
   tela, o recorte de datas e a chave de IA cifrada. Sem ele, quem configurou
   acesso perde tudo no próximo deploy, e a chave gravada fica ilegível junto com
   o `.secret` que a protegia.
3. **`TZ=America/Sao_Paulo` é dado, não log.** As bases guardam hora **local**, e
   os limites de data das consultas saem da hora do processo. Rodar em UTC
   desloca a janela de todas as telas em 3 horas.

Sem `FIREBASE_PROJECT_ID` o dashboard sobe **aberto**: todo mundo entra como
administrador, inclusive nas telas de desempenho individual (Produtividade e
Quartis). Em produção, preencha — e crie um projeto Firebase **próprio deste
sistema**, sem reaproveitar o de outro setor.

Saúde do serviço: `GET /api/geral/health`.

## Desempenho

O recorte de datas configura o **pedido**, não uma carga — não há ETL aqui, as
telas consultam o banco na hora. Medido em produção: esticar a janela de 30 para
365 dias leva Quartis de 0,7 s a **28,5 s**, e as tabelas de Produtividade a
~11 s; as outras nove telas ficam abaixo de 2 s. Daí o cache por rota em
`server/src/core/cache.js`, que guarda a **promessa** e não o valor — senão três
pessoas na mesma tela disparam três varreduras (ganho medido: 153x).
