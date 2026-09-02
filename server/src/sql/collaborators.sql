select id, name, email, team, operational_base, status
from API_WebDeveloper.db_senior_collaborators
where operational_base in (
  'AUX DE SUPERV DE SUPORTE TECNICO',
  'SUPERV SUPORTE TECNICO',
  'SUPORTE TÉCNICO',
  'TÉC - SUPORTE TÉCNICO'
)
