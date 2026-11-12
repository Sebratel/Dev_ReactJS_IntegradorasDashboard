select name, email, team, operational_base, supervisor_name,
       admission_date, termination_date, status
from API_WebDeveloper.db_senior_collaborators
where email is not null and email <> ''
