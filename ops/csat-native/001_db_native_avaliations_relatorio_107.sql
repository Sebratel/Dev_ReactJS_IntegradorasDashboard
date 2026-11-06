-- db_native_avaliations passa a receber a pesquisa da URA do Native (relatório 107).
--
-- Até aqui a tabela só tinha 44 linhas (01 a 04/12/2025), gravadas pelo fluxo
-- apis_matrixgo a partir da pesquisa 20 do MatrixGO (WhatsApp). Não era a pesquisa
-- do Native. A pesquisa de verdade é o relatório 107 da Native Infinity: uma linha
-- por PERNA de ligação, com Nota1, Nota2 e Nota3. Desde 01/09/2026 só a Nota1 vem
-- preenchida, escala de 1 a 5.
--
-- Como os dados do 107 entram nas colunas que já existem:
--   cod_atendimento  = Protocolo (numérico, até 17 dígitos; cabe no bigint)
--   num_protocolo    = Protocolo
--   nom_pergunta     = 'Nota1' | 'Nota2' | 'Nota3' (uma linha por nota preenchida)
--   nom_valor        = a nota
--   dat_resposta     = Data/Hora da ligação (a API não informa a hora da resposta)
--   num_telefone     = Número
--   nom_agente       = Agente
--   nom_tipo_integracao = 'URA'
--   nom_resposta, num_cpf, nom_conta = NULL (o 107 não tem)
--
-- Colunas novas:
--   origem   separa as duas fontes. O DEFAULT é a fonte antiga de propósito: o fluxo
--            apis_matrixgo continua com o INSERT sem esta coluna, e o que ele gravar
--            sai marcado como o que é.
--   ramal    numa transferência a MESMA nota aparece nas duas pernas (18 protocolos
--            entre set e nov/2026), cada uma com seu ramal e agente. A chave precisa
--            do ramal, senão a segunda perna sobrescreve a primeira. NOT NULL '' para
--            as linhas antigas, porque NULL não colide em chave única.
--   fila, sentido, desconexao   vêm do 107 e deixam a tela filtrar pela própria
--            avaliação, não só pelo atendimento.
--   atualizado_em   para carga incremental (Data Hub/Databricks): a nota é regravada
--            a cada execução do fluxo, e só muda quando algum valor muda.
--
-- Chave única: era (cod_atendimento, nom_pergunta); passa a ser
-- (origem, cod_atendimento, nom_pergunta, ramal). Para as linhas antigas dá na mesma.
--
-- Para voltar:
--   DELETE FROM API_WebDeveloper.db_native_avaliations WHERE origem = 'native_relatorio_107';
--   ALTER TABLE API_WebDeveloper.db_native_avaliations
--     DROP INDEX uk_avaliacao, DROP INDEX idx_origem_data,
--     ADD UNIQUE KEY unique_cod_nom (cod_atendimento, nom_pergunta),
--     DROP COLUMN origem, DROP COLUMN ramal, DROP COLUMN fila, DROP COLUMN sentido,
--     DROP COLUMN desconexao, DROP COLUMN atualizado_em;

ALTER TABLE API_WebDeveloper.db_native_avaliations
  ADD COLUMN origem varchar(30) NOT NULL DEFAULT 'matrix_pesquisa_20'
    COMMENT 'matrix_pesquisa_20 = fluxo apis_matrixgo (WhatsApp, parado em 04/12/2025); native_relatorio_107 = URA do Native'
    FIRST,
  ADD COLUMN ramal varchar(20) NOT NULL DEFAULT ''
    COMMENT 'Perna da ligacao no Native; numa transferencia a mesma nota aparece em cada perna'
    AFTER nom_agente,
  ADD COLUMN fila varchar(100) DEFAULT NULL AFTER ramal,
  ADD COLUMN sentido varchar(50) DEFAULT NULL AFTER fila,
  ADD COLUMN desconexao varchar(50) DEFAULT NULL AFTER sentido,
  ADD COLUMN atualizado_em timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  DROP INDEX unique_cod_nom,
  ADD UNIQUE KEY uk_avaliacao (origem, cod_atendimento, nom_pergunta, ramal),
  ADD KEY idx_origem_data (origem, dat_resposta);
