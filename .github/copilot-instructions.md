# Copilot Instructions

- Whenever code, configuration, deployment behavior, environment variables, API behavior, job semantics, or operator workflow changes, update the affected Markdown documentation before finishing the task.
- Always update `CHANGELOG.md` for user-visible, operational, deployment, or behavior changes.
- Keep the main documentation surfaces aligned when they are affected:
  - `README.md`
  - `backend/README.md`
  - `frontend/README.md`
  - `backend/system_en.md`
  - `backend/system_jp.md`
- For Alfresco deployment changes, document both runtime behavior and operator prerequisites such as Docker mount requirements, PostgreSQL access rules, and shortcut-handling behavior.
- Do not leave docs partially updated: if a change affects English and Japanese backend technical references, update both in the same task.
