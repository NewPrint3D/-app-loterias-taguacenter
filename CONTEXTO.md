# App de Loterias — Lotérica Taguacenter

App de gestão de bolões para lotérica física (Taguacenter, Brasília).
Frontend client-side + backend Node.js (Express) no Render + banco Neon PostgreSQL.
Dados persistidos no Neon via API REST — sincroniza entre dispositivos/países.
Sempre responder e escrever código em **português** (variáveis, funções, strings de UI, comentários).
**Estado em: 05/07/2026**

## Como rodar localmente

```
cd C:\Users\User\Downloads\apploterias
python -m http.server 8181
```

Abrir `http://localhost:8181` no navegador.

> Pra testar contra o backend local em vez de produção, trocar temporariamente
> `API_URL` em `js/app.js` pra `http://localhost:3000` e rodar `node server.js`
> dentro de `server/` (lembrar de reverter antes de commitar). O backend local
> não tem `DATABASE_URL`, então rotas que tocam o Neon dão 500 — só serve pra
> testar login/JWT/rotas que não dependem do banco.

## Estrutura do projeto

```
index.html          — telas, modais e shell do app
css/style.css       — estilos e tema escuro
js/config.js        — configurações centrais (APP, LOTERIAS, CREDS, MOCK, FRASES_ZE, TEMAS)
js/app.js           — toda a lógica: estado, auth, DB, router, views, WhatsApp, BOT, Dev
img/logo.png        — logo da Lotérica Taguacenter
img/ze-loteca.png   — mascote Zé Loteca
server/server.js    — API REST (Express + Neon PostgreSQL + Baileys WhatsApp Bot)
server/package.json — dependências do backend (express, pg, cors, baileys, qrcode, pino)
server/schema.sql   — schema das tabelas Neon (referência)
```

## Acessos / credenciais

| Perfil   | Nome no login | Senha              | Acesso |
|----------|---------------|--------------------|--------|
| Admin    | `admin`       | `admin123`         | Nav completa: Início, Grupos, Result., Admin, Conta |
| Dev      | `dev`         | `dev@zeloteca2024` | Igual admin + menu Controle Dev |
| Cliente  | qualquer nome | (sem senha)        | Digita nome + grupo do bolão → Nav: Início, Zé Loteca, Conta |

> Dev também pode ser acessado com 7 taps rápidos no logo do header (modo oculto) — mais confiável que o formulário em produção (cache).

> **Segurança (desde 04/07/2026):** as senhas acima são só as senhas de demonstração/dev. No
> servidor elas são validadas com **bcrypt** (nunca em texto puro) contra hashes que podem ser
> sobrescritos por env vars no Render (`ADMIN_SENHA_HASH`, `DEV_SENHA_HASH`). Login bem-sucedido
> devolve um **token JWT** (1h, renovação deslizante). Nunca colar essas senhas em documentos
> públicos/apresentações.

## Loterias suportadas

| Loteria       | Dezenas | Max | Preço  | Dias |
|--------------|---------|-----|--------|------|
| Mega-Sena    | 6       | 60  | R$5,00 | Quarta e Sábado* |
| Quina        | 5       | 80  | R$2,50 | Segunda a Sábado* |
| Lotofácil    | 15      | 25  | R$3,00 | Segunda a Sábado* |
| Lotomania    | 20      | 100 | R$3,00 | Segunda e Quinta* |
| Timemania    | 10      | 80  | R$3,50 | Ter, Qui e Sáb* |
| Dupla Sena   | 6       | 50  | R$2,50 | Ter, Qui e Sáb* |
| Dia de Sorte | 7       | 31  | R$2,50 | Terça e Sábado* |

> \* **Coluna "Dias" desatualizada e não exibida na UI desde 05/07/2026** — a Caixa reorganizou o
> calendário de sorteios em algum momento e esse texto nunca foi corrigido (confirmado
> comparando concursos reais contra a API oficial). A UI mostra só a data do próximo concurso
> (que vem certa da API a cada consulta) — não usar esta coluna pra nenhum cálculo.

## Arquitetura principal (js/app.js)

| Módulo            | Responsabilidade |
|-------------------|-----------------|
| `S`               | Estado global (usuário, tela, bolão, grupo atual, charts, S.cache com todos os dados) |
| `API_URL`         | `'https://api-loterias-taguacenter.onrender.com'` |
| `TOAST`           | Avisos flutuantes — erro de rede e sincronização da fila offline |
| `_token`          | get/set/clear do JWT em `localStorage['ltr_token']` |
| `_api`            | Helper fetch pra API REST — anexa Bearer token, renova via header `X-Token-Renovado`, retry automático (1s/3s/8s), enfileira em `localStorage['ltr_fila']` se esgotar tentativas |
| `carregarDados()` | Carrega todos os dados do Neon no login → preenche S.cache (parseia NUMERIC→number) |
| `DB`              | CRUD — leitura síncrona do S.cache, escrita fire-and-forget via `_api` + atualiza cache |
| `AUTH`            | Login async (bcrypt+JWT no servidor), logout, verificação de role |
| `API`             | Resultados da Caixa via `GET /api/caixa/...` do nosso backend (3 fontes + cache); proxies só sobrevivem no RELAY |
| `RELAY`           | Fallback final da conferência automática — busca resultado no navegador do admin e retransmite pro backend |
| `IA`              | Análise estatística de frequência (quentes/frios) |
| `ZE`              | Mascote Zé Loteca (frases rotativas + número animado) |
| `MODAL`           | Abre/fecha modal genérico |
| `R`               | Router + render de todas as views (navegação principal por **Grupo**, não por loteria) |
| `WPP`             | WhatsApp Manager + Cadastro Automático via bot |
| `BOT`             | WhatsApp Bot Baileys: conectar, QR, status, envio automático, JIDs |
| `CARTELA`         | Upload/download da cartela do bolão (imagem/vídeo/PDF) |
| `DEV`             | Painel de controle do desenvolvedor (bloquear app, licença, logs, reset, Bot WPP) |
| `TEMA`            | Sistema de temas sazonais (10 temas, partículas, faixa, persistência localStorage) |

> O módulo `SEED` (dados demo fictícios) foi **removido** em 05/07/2026 — banco de produção fica
> vazio até ter dados reais, sem repovoamento automático.

## Banco de dados — Neon PostgreSQL (9 tabelas)

```
grupos        — id, nome, link, membros, ativo, jid (JID WhatsApp para o bot)
boloes        — id, loteria, nome, grupo (texto histórico), grupo_id (FK→grupos, ON DELETE SET NULL),
                cotas_total, valor_cota, concurso, status, numeros (JSONB), criado,
                resultado (JSONB — dezenas, jogos, maiorAcerto, premioTotal, premiado, rateioPorCota, fonte, conferidoEm)
membros       — id, bolao_id (FK→boloes CASCADE), nome, fone, cotas, pago
vendas        — id, bolao_id, loteria, membro, cotas, valor, data
pagamentos    — id, bolao_id, membro, concurso, img, data, status
usuarios      — id, nome, ativo, criado, fone
config        — id=1 (única linha), bloqueado, msg, cliente, licenca, validade, logs (JSONB), admin_fone
wpp_auth      — chave TEXT PK, valor TEXT (sessão Baileys)
wpp_cadastros — jid TEXT PK, ativo BOOLEAN, mensagem TEXT, iniciado TIMESTAMPTZ (cadastro automático)
```

> IMPORTANTE: PostgreSQL retorna campos NUMERIC como string JS — `carregarDados()` converte com `+valor`.
> Colunas/tabelas extras são criadas via `ALTER TABLE / CREATE TABLE IF NOT EXISTS` no startup do server.js.

**Status possíveis de `boloes.status`:** `ativo` → `conferido` (fim feliz) ou `aguardando_resultado`
(as 3 fontes de resultado falharam, esperando relay do navegador de um admin) → `conferido`.

## API de resultados da Caixa

**Exibição geral** (home, resultados, IA, histórico) passa pelo nosso próprio backend:
`GET /api/caixa/:loteria/:concurso?` → cadeia de 3 fontes (guidi → loteriascaixa-api → Caixa
direto) com cache de 90s + coalescing de requisições concorrentes. allorigins/corsproxy foram
removidos desse fluxo principal (ambos ficaram pouco confiáveis servidor-a-servidor).

**Proxies (allorigins/corsproxy) sobrevivem só no RELAY** — usado exclusivamente quando as 3
fontes do próprio backend já falharam (ex: bloqueio de IP/país do Render); nesse caso o
navegador do admin busca direto e retransmite.

A conferência automática server-side (cron) usa uma cadeia própria sem cache, já que cada
bolão só é conferido uma vez por concurso.

## Formato de prêmios — fmtPremio(v, curto=false)

```
Padrão (curto=false): "R$ 7 milhões", "R$ 2,8 milhões", "R$ 1 bilhão"
Curto (curto=true):   "R$ 7M", "R$ 2,8Bi" (usado em contextos compactos)
```

## Autenticação JWT + retry/fila offline (04/07/2026)

- `POST /api/auth/login` valida com bcrypt, devolve `{ok, role, nome, token}` (JWT 1h, renovação
  deslizante via header `X-Token-Renovado`).
- Toda rota de escrita exige `Authorization: Bearer <token>`, exceto login, `/api/pagamentos`
  (cliente sem login envia comprovante) e `/api/config/log`.
- Aprovação de pagamento é rota própria protegida (`PUT /api/pagamentos/:id/status`) — a rota
  pública de criação sempre força `status='pendente'`, nunca aceita status do corpo.
- Frontend: toda escrita que falha tenta de novo (1s/3s/8s); esgotado, entra numa fila em
  `localStorage['ltr_fila']` reprocessada quando a conexão volta.

## WhatsApp Bot (Baileys) — desde 30/06/2026

- Auth persistente no Neon (tabela `wpp_auth`) — reconecta sozinho no boot se já tiver sessão salva.
- Painel Dev → 🤖 WhatsApp Bot → Conectar → QR em `/api/wpp/qr` → escanear.
- Envio automático pra grupos vinculados (JID), delay de 3s entre grupos (anti-ban).
- **Cadastro Automático** (01/07/2026): bot manda mensagem no grupo, quem responde com nome é
  cadastrado sozinho em `usuarios`.
- **Importação de participantes**: por grupo (botão "📱 Importar", via Baileys) ou por colagem de
  texto copiado do WhatsApp (botão "📋 Importar membros", não depende do bot).
  - Participantes com privacidade ativada aparecem com JID `@lid` — o WhatsApp **não entrega o
    telefone real** nesse caso pra nenhum app de terceiros. O app mostra "🔒 Número oculto" e
    deixa o campo de telefone **editável** nos modais de importação (05/07/2026) pra o admin
    preencher manualmente quando descobrir o número por outro meio.

## Conferência Automática de Resultados (04/07/2026)

- Cron às 21h e 22h (horário de Brasília), confere bolões `ativo`/`aguardando_resultado`.
- Cadeia de fontes: guidi → loteriascaixa-api → Caixa direto. Se as 3 falharem, bolão vira
  `aguardando_resultado` até o relay do navegador de um admin resolver.
- Calcula acertos/prêmio real (faixa de prêmio daquele concurso específico) e rateio por cota.
- **Ordem do aviso** (credibilidade: o dono nunca é o último a saber do próprio bolão):
  1. Resultado sai → WhatsApp pessoal do lotérico (`config.admin_fone`) é avisado **na hora**.
  2. **5 minutos depois**, o grupo do WhatsApp recebe o mesmo resultado.
- Seção "Resultado" no detalhe do bolão (bolinhas verdes nos números certos) + popup automático
  pro admin/dev quando um bolão premia.

## Grupos de Bolões — navegação principal (desde 05/07/2026)

A navegação virou "por Grupo" (aba do rodapé, antes era "por Loteria"): o lotérico manda ofertas
de cotas nos grupos de WhatsApp e nem todo mundo aceita — o que importa acompanhar é, por grupo,
quem aceitou, quem pagou e quem está com comprovante pendente de aprovação.

- `boloes.grupo_id` é uma FK real pra `grupos.id` (`ON DELETE SET NULL`) — antes era só texto
  livre, o que causava bolões "órfãos" quando um grupo era apagado/renomeado.
- Tela "Grupos" lista cada grupo com resumo (pago / aguardando aprovação / pendente); detalhe do
  grupo mostra os bolões + participantes consolidados.
- A navegação antiga por loteria continua acessível clicando no card da loteria na Home.

## Funcionalidades implementadas

- Splash screen + login (bcrypt + JWT); cliente entra só com nome + grupo (sem token)
- Retry automático + fila offline nas escritas
- Home admin/cliente — cards de loterias com prêmio ao vivo, próximo concurso e acumulado
- Zé Loteca (mascote) — frases rotativas
- **Grupos de Bolões** (navegação principal) — acompanhamento de pagamento por grupo
- Bolões — criar, excluir (admin/dev), detalhes (Resultado / IA / Membros)
- Membros — pagamento, comprovante, importação por colagem ou via bot do WhatsApp
- Gerador de jogos (IA) — 40% quentes + 20% frios + aleatório
- Conferência automática de resultados + aviso instantâneo ao admin + aviso ao grupo 5min depois
- Resultados gerais de todas as loterias
- Admin dashboard — total vendido, bolões, apostadores, ticket médio
- Apostadores — visão unificada app + bolões, dar acesso, registrar todos, telefone editável
- WhatsApp Manager + Cadastro Automático + Bot Baileys
- Cartela do bolão — drag-and-drop (imagem/vídeo/PDF)
- Estatísticas — filtros 7d/15d/30d/Tudo/Personalizado, Chart.js
- Pagamentos/Comprovantes — cliente envia, admin aprova/rejeita (rota protegida)
- Painel Dev — bloquear app, licença, logs, reset, WhatsApp Bot
- Temas Sazonais — 10 temas com partículas, faixa festiva
- UptimeRobot — pinga `/api/health` a cada 5 min

## Dados de teste

- `C:\Users\User\Downloads\comprovante para teste app loterias.jpeg`
- `C:\Users\User\Downloads\comprovante para teste app loterias (1).jpeg`

> Banco de produção está **zerado** desde 05/07/2026 (0 grupos, 0 bolões, 0 usuários, 0 vendas) —
> pronto pra dados reais do cliente. Sem SEED, não repovoa sozinho.

## Deploy — App Online

**URL Frontend:** https://app-loterias-taguacenter.onrender.com
**URL Backend:** https://api-loterias-taguacenter.onrender.com
**Banco de dados:** Neon PostgreSQL — schema em `server/schema.sql`
**GitHub:** https://github.com/NewPrint3D/-app-loterias-taguacenter
**UptimeRobot:** pinga `/api/health` a cada 5 min (evita sleep do Render)

### Como atualizar após mudanças

```
git add .
git commit -m "descrição"
git push
```

Render atualiza frontend + backend automaticamente em ~1-3 min.

## Próximos passos pendentes

1. **Chip brasileiro** — ao voltar ao Brasil: desconectar bot, novo chip, reconectar via QR
2. **Credenciamento Caixa (SISGEL)** — acesso a notificações de venda em tempo real, tipo ConectaLot
3. **Push notifications PWA** — pro admin, quando integração Caixa for aprovada
4. **Domínio personalizado** — `wvstudio3d.com` (subdomínio) ou comprar `apploteriastaguacenter.com`
5. **Configurar `JWT_SECRET` real no Render** — hoje usa fallback fixo funcional, não é segredo real
6. **Monitorar campo `resultado.fonte`** — se guidi/loteriascaixa-api pararem de responder do
   Render, precisa de uma 4ª fonte
