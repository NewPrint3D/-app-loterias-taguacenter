# App de Loterias — Lotérica Taguacenter

App de gestão de bolões para lotérica física (Taguacenter, Brasília).
Frontend client-side + backend Node.js (Express) no Render + banco Neon PostgreSQL.
Dados persistidos no Neon via API REST — sincroniza entre dispositivos/países.
Sempre responder e escrever código em **português** (variáveis, funções, strings de UI, comentários).
**Estado em: 11/07/2026** (Etapa 3 — Bolão Anual/Parcelado — implementada, aguardando deploy/validação em produção)

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
img/ze-loteca.png   — mascote "Palpiteiro" (arquivo/nome interno continua ze-loteca, só o nome exibido mudou)
server/server.js    — API REST (Express + Neon PostgreSQL + Baileys WhatsApp Bot)
server/package.json — dependências do backend (express, pg, cors, baileys, qrcode, pino)
server/schema.sql   — schema das tabelas Neon (referência)
```

## Acessos / credenciais

| Perfil   | Nome no login | Senha              | Acesso |
|----------|---------------|--------------------|--------|
| Admin    | `admin`       | `admin123`         | Nav completa: Início, Grupos, Result., Config., Conta |
| Dev      | `dev`         | `dev@zeloteca2024` | Igual admin + menu Controle Dev |
| Cliente  | nome completo + telefone (DDD) | (sem senha) | Nav: Início, Cotas, Palpiteiro, Conta |

> Dev também pode ser acessado com 7 taps rápidos no logo do header (modo oculto) — mais confiável que o formulário em produção (cache).

> **Login do cliente mudou em 10/07/2026** — não pede mais "grupo", pede nome completo + telefone,
> memorizado por aparelho (`localStorage`). Aba "Admin" da barra inferior virou **"Config."**;
> mascote "Zé Loteca" virou **"Palpiteiro"** (ver seção "Sessão 10-11/07/2026"). Campo de senha do
> admin/dev deixou de ser mascarado (`type="text"`) — usuário pediu pra ver o que digita.

> **Segurança (desde 04/07/2026):** as senhas acima são só as senhas de demonstração/dev. No
> servidor elas são validadas com **bcrypt** (nunca em texto puro) contra hashes que podem ser
> sobrescritos por env vars no Render (`ADMIN_SENHA_HASH`, `DEV_SENHA_HASH`). Login bem-sucedido
> devolve um **token JWT** (24h, renovação deslizante — aumentado de 1h em 09/07/2026). Nunca colar
> essas senhas em documentos públicos/apresentações.

## Loterias suportadas

| Loteria       | Dezenas | Max | Preço  | Formato especial |
|--------------|---------|-----|--------|------------------|
| Mega-Sena    | 6       | 60  | R$5,00 | — |
| Quina        | 5       | 80  | R$2,50 | — |
| Lotofácil    | 15      | 25  | R$3,00 | — |
| Lotomania    | 20      | 100 | R$3,00 | — |
| Timemania    | 10      | 80  | R$3,50 | — |
| Dupla Sena   | 6       | 50  | R$2,50 | — |
| Dia de Sorte | 7       | 31  | R$2,50 | — |
| **+Milionária** | 6    | 50  | R$6,00 | 6 dezenas + 2 trevos 1-6 (`trevos:2`) |
| **Super Sete**  | 7    | 9   | R$2,50 | 7 colunas, dígitos 0-9 (`colunas:7`) |

> +Milionária e Super Sete foram adicionadas em **09/07/2026** — detalhes logo abaixo.
> **Loteca foi removida em 11/07/2026** (confirmado com o cliente) — era baseada em resultado de
> jogos de futebol (palpite 1/X/2), formato muito diferente das demais (por dezenas numéricas).
> Removida do catálogo inteiro: `jogosHTML`, `API._buscarCaixaDireto` (fetch direto no navegador
> contornando bloqueio de IP do Render pra API da Caixa), parsing do resultado esportivo em
> `API.parse`, e o branch equivalente no backend (`server.js`, fonte `caixa-direto`). A seção
> "Loteca — busca direto da Caixa" que existia aqui foi removida junto por não ter mais utilidade.

## Loterias — visual oficial da Caixa + formatos especiais (09/07/2026)

Padronização visual seguindo as cores oficiais das Loterias Caixa e inclusão das 3 loterias que faltavam.

- **Cores oficiais da Caixa** em `js/config.js` (`cor` = base do card, `cor2` = tom escuro do degradê):
  Mega-Sena verde, Quina indigo, Lotofácil roxo, Lotomania laranja, Timemania amarelo-limão, Dupla
  Sena cranberry, Dia de Sorte dourado, Loteca vermelho, +Milionária indigo escuro, Super Sete verde.
- **Ícone = trevo multicolorido** (marca das Loterias Caixa) — SVG `TREVO_SVG(size)` em `js/app.js`
  (4 folhas em coração: azul/verde/laranja/amarelo, com caule). Substitui o emoji nos cards da Home.
  Nos dropdowns/textos inline ainda usa o emoji 🍀 (SVG não renderiza dentro de `<option>`).
- **Cor do texto por loteria** (campo `corTexto` no config → variável CSS `--lt-txt`): cards de fundo
  claro usam texto escuro — Super Sete e Timemania verde-escuro (`#1a5c2e`), Dia de Sorte marrom
  (`#4a2e08`). Os demais usam branco (padrão via `var(--lt-txt, #fff)`).
- **Formatos especiais no resultado:**
  - **Super Sete** — a API retorna 7 dígitos em `dezenas` → 7 bolinhas (0-9). Vem pela cadeia normal (loteriascaixa-api).
  - **+Milionária** — 6 dezenas + 2 trevos. O backend preserva `listaTrevos` em `paraFormatoCaixaBruto`;
    o front (`API.parse`) mapeia `trevos` e `trevosHTML(r)` exibe os trevos (verdes) após as dezenas.

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
| `ZE`              | Mascote **Palpiteiro** (ex-"Zé Loteca", renomeado 11/07/2026 — nome interno do módulo/CSS/imagem continua `ze`). Bolinha do número saiu de flutuar sobre a barra inferior e mora agora dentro do card "Bolões Ativos" da Home |
| `MODAL`           | Abre/fecha modal genérico |
| `R`               | Router + render de todas as views (navegação principal por **Grupo**, não por loteria) |
| `WPP`             | WhatsApp Manager + Cadastro Automático via bot |
| `BOT`             | WhatsApp Bot Baileys: conectar, QR, status, envio automático, JIDs |
| `CARTELA`         | Upload/download da cartela do bolão (imagem/vídeo/PDF) |
| `DEV`             | Painel de controle do desenvolvedor (bloquear app, licença, logs, reset, Bot WPP) |
| `TEMA`            | Sistema de temas sazonais (10 temas, partículas, faixa, persistência localStorage) |

> O módulo `SEED` (dados demo fictícios) foi **removido** em 05/07/2026 — banco de produção fica
> vazio até ter dados reais, sem repovoamento automático.

## Banco de dados — Neon PostgreSQL (16 tabelas)

```
grupos        — id, nome, link, membros (nº estimado digitado no cadastro), ativo, jid (JID WhatsApp para o bot)
grupo_membros — id, grupo_id (FK→grupos, ON DELETE CASCADE), nome, fone, wpp_jid, ativo, criado
                (cadastro PERMANENTE de apostadores do grupo, independente de bolão, importado
                automaticamente via bot — ver seção própria)
boloes        — id, loteria, nome, grupo (texto histórico), grupo_id (FK→grupos, ON DELETE SET NULL),
                cotas_total, valor_cota, concurso, status, numeros (JSONB), criado,
                resultado (JSONB — dezenas, jogos, maiorAcerto, premioTotal, premiado, rateioPorCota, fonte, conferidoEm)
membros       — id, bolao_id (FK→boloes CASCADE), nome, fone, cotas, pago
vendas        — id, bolao_id, loteria, membro, cotas, valor, data
pagamentos    — id, bolao_id, membro, concurso, img, data, status
usuarios      — id, nome, ativo, criado, fone
                (id determinístico 'ap_'+telefone quando vem do login do cliente — ver "Sessão
                10-11/07/2026"; ids aleatórios quando cadastrado manualmente pelo admin)
config        — id=1 (única linha), bloqueado, msg, cliente, licenca, validade, logs (JSONB), admin_fone
wpp_auth      — chave TEXT PK, valor TEXT (sessão Baileys)
wpp_cadastros — jid TEXT PK, ativo BOOLEAN, mensagem TEXT, iniciado TIMESTAMPTZ (cadastro automático)
lotes         — id, bolao_id, loteria, nome, concurso, total_cotas, valor_cota, duracao_min (prazo
                em minutos POR RESERVA — ver seção "Cotas ao Vivo"), inicia_em, expira_em, status
                (ativo/esgotado/encerrado), grupos (JSONB), aviso50, aviso_esgotado, espera (JSONB), criado
cotas         — id, lote_id (FK→lotes CASCADE), numero, status (livre/reservada/comprovante/paga),
                nome, fone, comprovante, reservada_em, pago_em, expira_em (prazo individual da
                reserva, liberado sozinho por cron se estourar sem comprovante), criado
premiacoes    — id, nome, fone, valor, mensagem, confirmada BOOLEAN, confirmada_em, criado
                (casamento apostador→premiação por telefone normalizado, não por nome)
boloes_parcelados             — id, nome, ano, valor_mensal, duracao_meses, valor_total, status, criado
                                 (bolão genérico com arrecadação mensal — ver seção "Bolão Anual")
bolao_parcelado_participantes — id, bolao_parcelado_id (FK CASCADE), nome, fone, quitado BOOLEAN,
                                 mes_quitacao_previsto (mês calendário 1-12 em que declarou pagar tudo
                                 de uma vez), quitado_em, ativo, criado
bolao_parcelado_pagamentos    — id, participante_id (FK CASCADE), mes (1-12, calendário), valor,
                                 comprovante, status (pendente/confirmado/rejeitado), enviado_em,
                                 confirmado_em — UNIQUE(participante_id,mes): reenvio do mesmo mês
                                 substitui, não duplica
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

- `POST /api/auth/login` valida com bcrypt, devolve `{ok, role, nome, token}` (JWT 24h — aumentado
  de 1h em 09/07/2026 —, renovação deslizante via header `X-Token-Renovado`).
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
    telefone real** nesse caso pra nenhum app de terceiros. O campo de telefone fica **editável**
    nos modais de importação pra o admin preencher manualmente quando descobrir o número por outro
    meio. (Os avisos de texto "número oculto pelo WhatsApp" foram removidos da UI em 05/07/2026 a
    pedido do usuário — o comportamento do campo continua igual, só o aviso saiu.)

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

## Cadastro de Apostadores do Grupo — independente de bolão (05/07/2026)

Grupo é uma lista permanente de possíveis apostadores; bolão é uma oferta pontual que o lotérico
faz a um ou mais grupos, e nem todo mundo aceita comprar. Por isso "quem está no grupo" não pode
depender de existir algum bolão ativo — tabela nova `grupo_membros` guarda esse cadastro
permanente (nome + telefone), independente de bolão.

- Tela de grupo ganhou seção **"Apostadores do grupo"** (sempre visível, mesmo sem bolão nenhum):
  adicionar manual, colar lista (mesmo parser da importação de membros de bolão), editar, remover.
- **Integrado** com: contagem "Apostadores" do dashboard Admin, badge "Só grupo" na tela
  Apostadores, WhatsApp → Participantes (dá pra mandar cota/aviso individual mesmo sem bolão),
  contador do card de grupo na tela WhatsApp.
- Grupo sem nenhum cadastro individual ainda soma automaticamente o "Nº de membros" digitado no
  cadastro do grupo (estimativa) — some sozinha assim que alguém cadastrar os nomes de verdade.
- Card **"Grupos"** novo no dashboard Admin (total de grupos cadastrados).
- **Importação 100% automática via bot** (06/07/2026): `groupMetadata()` cadastra todos os
  participantes ao vincular o grupo (ou pelo botão "⬇️ Importar"); listener `group-participants.
  update` mantém entrada/saída sincronizada; listener `messages.upsert` preenche o nome via
  `pushName` quando a pessoa fala. Índice único parcial (`grupo_id+wpp_jid`) evita duplicar quem
  já foi cadastrado.
- **Resolução de número oculto (LID)**: atualizado o bot pra Baileys **v7** (release candidate —
  risco aceito conscientemente) especificamente pra ter acesso à API `lidMapping.getPNForLID`, que
  tenta resolver o telefone real de quem aparece como `@lid`. Não é garantido pra todo mundo —
  depende do bot já ter alguma sessão com a pessoa. Nome/telefone também são atualizados por
  `contacts.upsert`/`update` (sincronização de contatos) e por um backfill automático a cada 6h.
- Quem ainda não foi identificado aparece na tela como **"Participante N"** (não mais "Sem nome"
  cru), com um badge discreto "aguardando identificação".

## Cotas ao Vivo — Bolão Relâmpago (07/07/2026, cronômetro reformulado em 10/07/2026)

Serviço de venda por urgência pedido pelo cliente. O admin abre um **lote** de N cotas de um bolão
acumulado, e o bot divulga nos grupos vinculados. O cliente entra no app (nome completo + telefone),
**escolhe uma cota livre**, reserva com o nome e, depois de pagar, **anexa o comprovante** na
própria cota. Contador **X/N** ao vivo, aviso de **50%** e mensagem de **esgotado** postados
automaticamente no grupo pelo bot.

> **Cronômetro é por RESERVA individual, não mais um prazo único do lote** (mudou em 10/07/2026,
> revisando o pedido original do usuário linha por linha — achou uma inconsistência real com uma
> decisão de uma sessão anterior). Cada pessoa que reserva uma cota tem `duracao_min` minutos pra
> pagar; se não pagar, só a cota dela libera sozinha (cron a cada minuto) — a venda continua aberta
> pros outros, o lote **não** fecha por tempo (só manualmente ou esgotando 100%).

- **Backend (`server/server.js`)** — módulo "COTAS AO VIVO":
  - Tabelas `lotes` e `cotas` (criadas via `CREATE TABLE IF NOT EXISTS`, migração aguardada antes de
    `app.listen()`; ref. em `schema.sql`). `cotas.expira_em` guarda o prazo da reserva individual.
  - Status da **cota**: `livre` → `reservada` (só nome, `expira_em` = agora + `duracao_min` do lote)
    → `comprovante` (anexou, `expira_em` limpo, conta no X/N) → `paga` (admin confere e confirma).
    Status do **lote**: `ativo` → `esgotado` (100% vendido) / `encerrado` (só manual, "Encerrar agora").
  - Reserva **atômica**: `UPDATE cotas SET status='reservada', expira_em=... WHERE status='livre'
    AND lote_id IN (SELECT id FROM lotes WHERE status='ativo')` — dois clientes não pegam a mesma
    cota; lote não expira mais por tempo, só por status.
  - Rotas: `GET/POST/DELETE /api/lotes`, `PUT /api/lotes/:id/encerrar`, `GET /api/lotes/:id`,
    **públicas** `POST /api/cotas/:id/reservar` e `/comprovante` (cliente sem token),
    protegidas `PUT /api/cotas/:id/confirmar` e `/liberar` (admin).
  - `postarNosGrupos()` usa o bot Baileys (delay 3s anti-ban). `verificarMarcosLote()` dispara 50%
    e esgotado uma única vez (flags `aviso50`/`aviso_esgotado`).
  - **Cron a cada minuto libera sozinhas as cotas `reservada` cujo `expira_em` já passou** (volta
    pra `livre`, limpa nome/fone/comprovante) — antes fechava o lote inteiro e deixava a cota
    travada em `reservada` pra sempre; comportamento trocado a pedido do usuário. Listener "**fiquei
    de fora**" no bot: quem manda isso entra na lista de espera (`lotes.espera`) do último lote do
    grupo e avisa o lotérico no WhatsApp pessoal.
- **Frontend (`js/app.js` módulo `COTAS`)**:
  - Admin: menu Config. → **🧾 Cotas ao Vivo** (tela `lotes`) — criar lote (modal, label "Prazo pra
    pagar após reservar"), acompanhar ao vivo (X/N, grid de cotas com nome/status + cronômetro por
    cota reservada), **confirmar/liberar** cada cota, ver comprovante, popup a cada venda. Polling de
    3s + cronômetro de 1s por cota (não mais um único cronômetro no cabeçalho do lote).
  - Cliente: nav **🧾 Cotas** (tela `cotas`) + card **"Bolões Ativos"** em destaque no topo da Home
    (substituiu o banner fino de antes) — escolher cota, reservar (nome pré-preenchido), anexar
    comprovante (base64), ver o próprio cronômetro de pagamento contando.
  - Cota do cliente é lembrada em `localStorage['ltr_minhas_cotas']` — `_minhaCota()` agora também
    checa se a cota salva voltou pra `livre` (reserva expirou) e não mostra mais como "sua cota"
    nesse caso.

## Bolão Anual/Parcelado (11/07/2026)

Sistema **genérico** (não hardcoded pra Mega da Virada) de bolões com arrecadação mensal — ex:
R$85/mês × 12 meses = R$1020, ou quitar tudo de uma vez num mês à escolha. Mês de referência é
sempre **mês calendário** (1=janeiro...12=dezembro), independente de quando o bolão começou.

- **Admin** — Config. → **📅 Bolão Anual**: lista de bolões cadastrados (nome, ano, valor mensal ×
  duração → valor total calculado automaticamente), botão "+ Participante" no detalhe. Detalhe do
  bolão (`R._anualDet`) mostra a **planilha completa** (participante × mês, célula colorida: ✅ pago,
  ⏳ aguardando confirmação, 🔴 inadimplente, 💰 quitado, — mês futuro) + 2 gráficos Chart.js
  (quitados/em dia/inadimplentes; arrecadado × esperado). Clicar numa célula pendente/paga abre o
  comprovante e permite confirmar/rejeitar.
- **Cliente** — card na Home (estilo "Bolões Ativos", borda dourada) só aparece se o telefone bater
  com algum participante cadastrado — não polui a Home de quem não participa. Tela "Meu Bolão
  Anual": grade de meses, botão **"Enviar comprovante"** (mês em texto livre — "mês de julho"/"mês
  07"/"07", parseado por `parseMesReferencia()`; avisa "Mês de referência, por favor." se vazio/não
  reconhecido, ou "Você está com o mês de [X] em aberto..." se não bater com o primeiro mês ainda
  não pago) e **"Declarar quitação"** (escolhe o mês em que vai pagar tudo de uma vez).
- **Quitação automática**: quando o admin confirma um comprovante cujo mês bate com o
  `mes_quitacao_previsto` do participante, o backend marca `quitado=true` sozinho — não precisa
  criar pagamento pra cada um dos 12 meses.
- **Rotas** (`server.js`): `GET /api/boloes-parcelados` (pública, aninhado bolão→participantes→
  pagamentos); `POST/DELETE /api/boloes-parcelados` e `/bolao-parcelado-participantes` (protegidas,
  admin); `PUT /bolao-parcelado-participantes/:id/quitacao` (pública, cliente declara intenção);
  `POST /bolao-parcelado-pagamentos` (pública, força `status='pendente'` no servidor, mesmo padrão
  defensivo de `/api/pagamentos` — `ON CONFLICT(participante_id,mes) DO UPDATE`, reenvio substitui);
  `PUT /bolao-parcelado-pagamentos/:id/status` (protegida, confirma/rejeita e aplica a quitação
  automática).
- **Fora do escopo desta primeira versão**: gráfico de padrão de datas de pagamento por apostador
  (precisaria de histórico de dia-do-mês) e cobrança automática via WhatsApp — ambos ficam pra um
  follow-up se o usuário quiser.
- **Bug pego em teste local antes do commit**: o envio de comprovante do lado do cliente
  (`_envCompAnual`) não incluía `status:'pendente'` no objeto otimista local — a célula da planilha
  mostrava 🔴 (inadimplente) em vez de ⏳ (aguardando confirmação) até a próxima sincronização com o
  servidor. Corrigido incluindo `status`/`enviado_em` explícitos no payload, mesmo padrão já usado
  em `R._envComp` (Cotas ao Vivo).

## Funcionalidades implementadas

- Splash screen + login (bcrypt + JWT 24h, senha em texto puro); cliente entra com **nome completo +
  telefone** (memorizado por aparelho, sem token)
- Retry automático + fila offline nas escritas
- Home cliente — card **"Bolões Ativos"** em destaque no topo (leva pro Cotas ao Vivo) + resumo de
  participação, depois cards de loterias com prêmio ao vivo, próximo concurso e acumulado
- Home admin — cards de loterias com prêmio ao vivo
- Palpiteiro (mascote, ex-"Zé Loteca") — bolinha do número dentro do card Bolões Ativos
- Cotas ao Vivo / Bolão Relâmpago — cronômetro por reserva individual (não mais por lote), cota
  libera sozinha se estourar o prazo sem comprovante
- Premiação — admin cadastra prêmio por nome+telefone, apostador confirma com fogos de artifício
- **Bolão Anual/Parcelado** — sistema genérico de arrecadação mensal, planilha completa (participante
  × mês) com gráficos pro admin, upload de comprovante com mês livre + declaração de quitação pro cliente
- **Grupos de Bolões** (navegação do admin) — acompanhamento de pagamento por grupo
- Bolões — criar, excluir (admin/dev), detalhes (Resultado / IA / Membros)
- Membros — pagamento, comprovante, importação por colagem ou via bot do WhatsApp
- Gerador de jogos (IA) — 40% quentes + 20% frios + aleatório
- Conferência automática de resultados + aviso instantâneo ao admin + aviso ao grupo 5min depois
- Resultados gerais de todas as loterias
- Admin dashboard — total vendido, bolões, grupos, apostadores (real + estimativa), ticket médio
- Cadastro de apostadores do grupo — independente de bolão, adicionar manual ou colar lista
- **Apostadores → "Banco de Clientes"** — separa quem entrou no app com nome+telefone (base
  confiável pra divulgação, com botão "Copiar telefones") de quem só está em bolões/grupos
- WhatsApp Manager + Cadastro Automático + Bot Baileys
- Cartela do bolão — drag-and-drop (imagem/vídeo/PDF)
- Estatísticas — filtros 7d/15d/30d/Tudo/Personalizado, Chart.js
- Pagamentos/Comprovantes — cliente envia, admin aprova/rejeita (rota protegida)
- Painel Dev — bloquear app, licença, logs, reset, WhatsApp Bot
- Temas Sazonais — 10 temas com partículas, faixa festiva
- UptimeRobot — pinga `/api/health` a cada 5 min
- Seta de voltar aparece em qualquer tela que não seja a Início, não importa como o usuário chegou nela

## Sessão 10-11/07/2026 — Login por telefone, Bolões Ativos, Premiação, Banco de Clientes, Palpiteiro, UX

Retomada de um trabalho que tinha sido interrompido (limite de gasto mensal, antes de qualquer
código) sobre 4 funcionalidades grandes. Decidiu entregar em etapas testadas em produção uma de
cada vez.

**Etapa 1** (commits `4cee79a`, `d4abc47`): login do cliente virou nome completo + telefone
(memorizado por aparelho); card "Bolões Ativos" na Home substituiu o banner fino de antes; fix da
migração `lotes`/`cotas` não aguardada antes de `app.listen()`.

**Etapa 2** (commits `b04b806`, `38b66e7`, `3f6745e`): **bug real corrigido** — o registro do
apostador no login chamava `POST /api/usuarios`, rota que exige token de admin; cliente nunca tem
token, então sempre dava 401 silencioso e o apostador nunca persistia de verdade. Nova rota pública
`POST /api/usuarios/registrar` resolve. **Premiação** nova: admin cadastra prêmio por
nome+telefone, apostador vê fogos de artifício automáticos no login quando tem premiação pendente
e confirma; ícone 🏆 no header leva pro histórico "Minhas Premiações".

**Cronômetro do Cotas ao Vivo virou por reserva individual** (ver seção própria acima) — achado
revisando o pedido original do usuário linha por linha, confirmado e corrigido, validado em
produção com lote de teste real.

**Ajustes depois da Etapa 2** (todos em produção):
- Loteca removida do catálogo (commit `d9b78ed`, confirmado com o cliente) — ver seção "Loterias suportadas".
- Tela "Apostadores" reorganizada em **"Banco de Clientes"** + aba "Admin"→**"Config."** (commit `20d0d80`).
- Mascote "Zé Loteca"→**"Palpiteiro"** (commit `f009fa8`, confirmado com o cliente) — só o nome
  exibido mudou, imagem e identificadores internos (`ZE`, `.ze-*`) continuam iguais.
- **Quatro ajustes de UX numa leva só** (commit `171329c`): (1) senha do admin/dev deixou de ser
  mascarada; (2) ícone 🎟️ (parecia ticket de cinema) trocado por 🧾 em todo o app; (3) bolinha do
  Palpiteiro saiu de flutuar sobre a barra inferior e foi pro card "Bolões Ativos", logo após "toque
  para conferir" — a bolha de fala das frases rotativas (`FRASES_ZE`) foi removida junto por não ter
  mais lugar óbvio (código ficou inerte com guarda de nulo, não quebra); (4) seta de voltar corrigida
  em duas rodadas — a primeira tentativa (`R.irTab()`, resetando a pilha nos ícones de barra) ainda
  deixava faltando seta ao entrar em telas direto pela barra inferior; corrigido de vez (commit
  `f438ee8`) pra regra simples: seta aparece em qualquer tela que não seja a Início, sempre.
- Fix de um achado durante o teste do item 4: texto do card "Palpiteiro te ajuda" sobrepondo a
  imagem do mascote — `padding-right` no texto + imagem um pouco menor (commit `8e51ffb`).
- **Esclarecimento sem mudança de código:** tela "Premiação" mostrar o próprio nome mesmo sem
  premiação não é bug — é a tela pessoal "Minhas Premiações", sempre mostra quem está logado.

**Cuidado de automação anotado:** botões que disparam `confirm()` nativo travam a aba inteira
quando clicados via automação de browser — usar `DB.x.del(id)`/`_api.del(...)` direto no console
pra apagar dados de teste, nunca clicar no botão que abre o `confirm()`.

**Etapa 3 — Bolão Anual/Parcelado** (11/07/2026): 4ª e última funcionalidade grande combinada no
início da sessão — ver seção própria "Bolão Anual/Parcelado" acima para detalhes completos (schema,
rotas, telas admin/cliente, quitação automática). Testada localmente ponta a ponta (criar bolão,
adicionar participante, enviar comprovante de mês errado → aviso, mês certo → pendente, admin
confirma → pago, declarar quitação → confirmar o mês previsto → quitado automático, gráficos)
antes do commit — como o backend de produção ainda não tinha as rotas novas na hora do teste local,
os testes iniciais rodaram só em cache local (POST retornando 404 silencioso); a validação de
verdade em produção (com dados reais de teste + limpeza) acontece depois do deploy.

## Dados de teste

- `C:\Users\User\Downloads\comprovante para teste app loterias.jpeg`
- `C:\Users\User\Downloads\comprovante para teste app loterias (1).jpeg`

> Banco de produção foi zerado em 05/07/2026 (sem SEED, não repovoa sozinho) e já tem dados reais
> entrando: 3 grupos (2 de teste do próprio usuário + "Bolões da Lotérica", real) e ~40 apostadores
> cadastrados no grupo real (11 com nome, 29 só com telefone, ainda sem bolão nenhum criado).

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
7. **Confirmar versão do Node no Render** — Baileys v7 exige Node ≥20 (`engines` declarado, mas
   sem acesso ao painel do Render pra confirmar 100% que o serviço já está numa versão compatível)
8. **Acompanhar estabilidade do Baileys 7.0.0-rc13** (release candidate, não é versão estável
   final) e quantos apostadores continuam sem nome/telefone resolvido depois de um tempo
