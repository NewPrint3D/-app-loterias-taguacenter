---
name: app-loterias-taguacenter
description: >-
  Playbook completo do App de Loterias da Lotérica Taguacenter (Wesley / Newprint3D) — gestão de
  bolões para lotérica física, com frontend client-side, backend Node/Express no Render e banco Neon
  PostgreSQL. Use SEMPRE que o usuário falar sobre o app de loterias, bolões, cotas, Bolão Relâmpago /
  Cotas ao Vivo, grupos de WhatsApp do app, bot Baileys, resultados/loterias da Caixa, Loteca,
  +Milionária, Super Sete, comprovantes, apostadores, deploy no Render, banco Neon, ou quiser
  retomar/evoluir esse projeto. Não espere o usuário citar a skill — ative no contexto do app de loterias.
---

# App de Loterias — Lotérica Taguacenter

App de gestão de bolões para lotérica física (Taguacenter, Brasília). Sempre responder e escrever
código em **português** (variáveis, funções, strings de UI, comentários).

## Stack e onde fica
- **Frontend** client-side: `index.html`, `css/style.css`, `js/config.js`, `js/app.js`.
- **Backend** Node/Express: `server/server.js` (+ `schema.sql` de referência). Banco **Neon PostgreSQL**.
- **Pasta local:** `C:\Users\User\Downloads\AppLoterias`. Ler `CONTEXTO.md` (raiz) antes de qualquer
  alteração — é o documento vivo, sempre atualizado.
- **GitHub:** https://github.com/NewPrint3D/-app-loterias-taguacenter (branch `main`).
- **Produção (deploy automático via Render a cada push):**
  - Frontend (Static Site): https://app-loterias-taguacenter.onrender.com
  - Backend (Web Service, plano **Free** — dorme e tem cold start de ~50s): https://api-loterias-taguacenter.onrender.com

## Regras de trabalho
- Código e respostas **em português**.
- **Nunca dar `git push` sem confirmação explícita** do usuário.
- Rodar local: `python -m http.server 8181` na raiz do projeto.
- Deploy: `git add ... && git commit && git push` → Render publica frontend e backend em 1-3 min.
- **Não commitar/expor senhas nem a `DATABASE_URL`** (é segredo do banco).
- O ambiente da sessão pode ter o mount de arquivos defasado — os arquivos reais (Windows) são a
  fonte da verdade; validar sintaxe de trechos isoladamente quando o `node --check` do arquivo
  inteiro der "Unexpected end of input" (costuma ser leitura defasada, não erro real).

## Acessos (só demo/dev — validados com bcrypt+JWT no servidor)
- Admin: nome `admin`, senha `admin123`. Dev: `dev` / `dev@zeloteca2024` (ou 7 taps no logo).
- Cliente: qualquer nome + nome do grupo (sem senha).

## Loterias (10)
Config em `js/config.js` → objeto `LOTERIAS`. Cada uma: `id, nome, emoji, dezenas, max, preco, cor,
cor2, corTexto?, api, dias` + flags de formato especial.
- Normais: Mega-Sena, Quina, Lotofácil, Lotomania, Timemania, Dupla Sena, Dia de Sorte.
- Especiais (add 09/07/2026): **Loteca** (`palpite:true`, 14 jogos 1/X/2), **+Milionária**
  (`trevos:2`, 6 dezenas + 2 trevos), **Super Sete** (`colunas:7`, 7 dígitos 0-9).

### Visual oficial da Caixa (09/07/2026)
- `cor`/`cor2` seguem as cores oficiais das Loterias Caixa.
- Ícone = **trevo multicolorido** (SVG `TREVO_SVG(size)` em `app.js`, 4 folhas coração azul/verde/
  laranja/amarelo) nos cards. Dropdowns/texto inline ainda usam emoji 🍀.
- `corTexto` (via CSS `--lt-txt`): texto escuro em cards claros — Super Sete/Timemania verde-escuro
  `#1a5c2e`, Dia de Sorte marrom `#4a2e08`; demais branco.

### Resultados / fontes
- Backend `GET /api/caixa/:loteria/:concurso?` → cadeia guidi → loteriascaixa-api → Caixa direto,
  cache 90s. Frontend módulo `API` (`ultimos3`, `parse`).
- **Trevos** (+Milionária): backend preserva `listaTrevos`; front `trevosHTML(r)`.
- **Loteca:** só existe na API oficial da Caixa e **o Render não a alcança** (bloqueio de IP). Como a
  Caixa libera CORS, o **navegador do usuário busca direto** (`API._buscarCaixaDireto`, só p/
  `palpite:true`). `API.parse` monta `jogos[{casa,fora,golCasa,golFora,res}]`; `jogosHTML(r)` exibe
  os 14 jogos + palpite 1/X/2 (CSS `.lj-res-1/X/2`). Limitação: só carrega no Brasil.

## Cotas ao Vivo — Bolão Relâmpago (07/07/2026)
Venda por urgência: admin abre um **lote** de N cotas com **cronômetro regressivo** (5/10/15/30 min),
o bot divulga nos grupos; cliente escolhe a cota, reserva com o nome e anexa o comprovante.
- **Backend** (`server.js`): tabelas `lotes` e `cotas`; reserva **atômica** (`UPDATE ... WHERE
  status='livre'`); rotas `GET/POST/DELETE /api/lotes`, `PUT /api/lotes/:id/encerrar`, públicas
  `POST /api/cotas/:id/reservar` e `/comprovante`, protegidas `PUT /api/cotas/:id/confirmar` e
  `/liberar`. Bot posta 50% e "esgotado"; cron encerra por tempo; "fiquei de fora" vira lista de espera.
  - Status cota: `livre → reservada → comprovante → paga`. Status lote: `ativo → esgotado/encerrado`.
  - **IMPORTANTE:** criar as tabelas `lotes`/`cotas` em ORDEM com `await` (cotas tem FK p/ lotes) — a
    versão antiga com 3 `pool.query().catch(()=>{})` em paralelo travava/engolia erro.
- **Frontend** (`js/app.js`, módulo `COTAS`): Admin → 🎟️ Cotas ao Vivo (criar lote, acompanhar ao
  vivo, confirmar/liberar, popup de venda); Cliente → nav 🎟️ Cotas + banner na Home (escolher,
  reservar, anexar comprovante, contador X/N, aviso 50%). Cota do cliente em `localStorage['ltr_minhas_cotas']`.

## Outras funcionalidades (resumo)
Login bcrypt+JWT; Grupos de Bolões (acompanhamento de pagamento por grupo); Bolões (criar/conferir);
cadastro de apostadores por grupo (independente de bolão); WhatsApp Manager + **Bot Baileys**
(cadastro automático, importação de participantes, resolução de LID/telefone); conferência automática
de resultados (cron 21h/22h) com aviso ao lotérico e ao grupo; pagamentos/comprovantes; painel Dev
(bloquear app, licença, logs); temas sazonais; UptimeRobot pingando `/api/health`.

## Pendências conhecidas
- Backend no plano **Free** do Render dorme (cold start ~50s) — ruim p/ Cotas ao Vivo (cronômetro).
  Considerar subir o Web Service `api-loterias-taguacenter` p/ plano pago (Settings → Instance Type).
- Loteca só carrega no Brasil (busca direto da Caixa pelo navegador).
- `JWT_SECRET` real no Render (hoje usa fallback fixo).
