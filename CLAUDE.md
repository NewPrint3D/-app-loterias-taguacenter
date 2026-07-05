# App de Loterias — Lotérica Taguacenter

Antes de fazer qualquer alteração neste projeto, leia `CONTEXTO.md` (raiz deste repositório)
por completo — ele tem a arquitetura, o banco de dados, as URLs de produção, o que já foi
implementado e o que ainda está pendente, sempre atualizado.

Regras rápidas (detalhes completos em `CONTEXTO.md`):
- Responder e escrever código sempre em **português** (variáveis, funções, strings de UI, comentários).
- Frontend client-side (`index.html`/`js/`/`css/`) + backend Node/Express (`server/`) + Neon PostgreSQL.
- Nunca dar `git push` sem confirmação explícita do usuário.
- Rodar local: `python -m http.server 8181` na raiz do projeto.
- Produção: https://app-loterias-taguacenter.onrender.com (frontend) e
  https://api-loterias-taguacenter.onrender.com (backend) — deploy automático via Render a cada push.
