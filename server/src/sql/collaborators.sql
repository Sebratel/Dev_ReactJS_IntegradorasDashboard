select name, email, team, operational_base, supervisor_name, coordinator_name,
       admission_date, termination_date, status
from API_WebDeveloper.db_senior_collaborators
where name is not null and name <> ''
