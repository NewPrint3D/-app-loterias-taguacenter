# App de Loterias — Lotérica Taguacenter

App de gestão de bolões para lotérica física (Taguacenter, Brasília).
Frontend client-side + backend Node.js (Express) no Render + banco Neon PostgreSQL.
Dados persistidos no Neon via API REST — sincroniza entre dispositivos/países.
Sempre responder e escrever código em **português** (variáveis, funções, strings de UI, comentários).
**Estado em: 09/07/2026**

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

| Loteria       | Dezenas | Max | Preço  | Formato especial |
|--------------|---------|-----|--------|------------------|
| Mega-Sena    | 6       | 60  | R$5,00 | — |
| Quina        | 5       | 80  | R$2,50 | — |
| Lotofácil    | 15      | 25  | R$3,00 | — |
| Lotomania    | 20      | 100 | R$3,00 | — |
| Timemania    | 10      | 80  | R$3,50 | — |
| Dupla Sena   | 6       | 50  | R$2,50 | — |
| Dia de Sorte | 7       | 31  | R$2,50 | — |
| **Loteca**   | 14      | 3   | R$2,00 | 14 jogos de futebol, palpite 1/X/2 (`palpite:true`) |
| **+Milionária** | 6    | 50  | R$6,00 | 6 dezenas + 2 trevos 1-6 (`trevos:2`) |
| **Super Sete**  | 7    | 9   | R$2,50 | 7 colunas, dígitos 0-9 (`colunas:7`) |

> As 3 últimas (Loteca, +Milionária, Super Sete) foram adicionadas em **09/07/2026** — detalhes logo abaixo.

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
  - **Loteca** — 14 jogos de futebol (times + placar), palpite **1/X/2** derivado do placar (casa
    venceu = 1, empate = X, fora venceu = 2). Helper `jogosHTML(r)`. Ver integração abaixo.

### Loteca — busca direto da Caixa pelo navegador (09/07/2026)

A Loteca **só existe na API oficial da Caixa** (`servicebus2.caixa.gov.br/portaldeloterias/api/loteca`)
— guidi e loteriascaixa-api não a servem. **O servidor do Render NÃO alcança a API da Caixa** (bloqueio
de IP), mas a **Caixa permite CORS**, então o próprio navegador do usuário (no Brasil) busca direto:

- `API._buscarCaixaDireto(lt, conc)` em `js/app.js` faz `fetch` direto na Caixa quando a loteria tem
  `palpite:true` (só a Loteca). Sem proxy, sem passar pelo backend.
- `API.parse` detecta `listaResultadoEquipeEsportiva` e monta `jogos:[{casa, fora, golCasa, golFora,
  res}]` + prêmio/próximo concurso (funciona no card e na aba Resultados).
- Palpite colorido no CSS: `.lj-res-1` verde (casa), `.lj-res-X` laranja (empate), `.lj-res-2` azul (fora).
- **Limitação:** por vir direto da Caixa pelo navegador, a Loteca só carrega de dispositivos que
  acessam a Caixa (Brasil). Fora do país o card da Loteca pode ficar vazio (as outras continuam via backend).
- O backend também aceita Loteca na fonte `caixa-direto`, mas é inócuo (Render não alcança a Caixa) —
  fica como fallback caso a conectividade mude.

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

## Banco de dados — Neon PostgreSQL (10 tabelas)

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

## Cotas ao Vivo — Bolão Relâmpago (07/07/2026)

Serviço de venda por urgência pedido pelo cliente. O admin abre um **lote** de N cotas de um bolão
acumulado, com **contador regressivo** (5/10/15/30 min), e o bot divulga nos grupos vinculados. O
cliente abre o app (nome + grupo, sem login), **escolhe uma cota livre**, reserva com o nome e,
depois de pagar, **anexa o comprovante** na própria cota. Contador **X/N** ao vivo, aviso de **50%**
e mensagem de **esgotado** postados automaticamente no grupo pelo bot.

- **Backend (`server/server.js`)** — módulo "COTAS AO VIVO":
  - Tabelas `lotes` e `cotas` (criadas via `CREATE TABLE IF NOT EXISTS` no startup; ref. em `schema.sql`).
  - Status da **cota**: `livre` → `reservada` (só nome) → `comprovante` (anexou, conta no X/N) →
    `paga` (admin confere e confirma). Status do **lote**: `ativo` → `esgotado`/`encerrado`.
  - Reserva **atômica**: `UPDATE cotas SET status='reservada' ... WHERE status='livre' AND lote ativo`
    — dois clientes não pegam a mesma cota; se o tempo/cota esgotou devolve 409 "escolha outra".
  - Rotas: `GET/POST/DELETE /api/lotes`, `PUT /api/lotes/:id/encerrar`, `GET /api/lotes/:id`,
    **públicas** `POST /api/cotas/:id/reservar` e `/comprovante` (cliente sem token),
    protegidas `PUT /api/cotas/:id/confirmar` e `/liberar` (admin).
  - `postarNosGrupos()` usa o bot Baileys (delay 3s anti-ban). `verificarMarcosLote()` dispara 50%
    e esgotado uma única vez (flags `aviso50`/`aviso_esgotado`).
  - Cron a cada minuto encerra lotes cujo cronômetro passou (reservas sem pagamento ficam pendentes
    pro admin decidir). Listener "**fiquei de fora**" no bot: quem manda isso entra na lista de
    espera (`lotes.espera`) do último lote do grupo e avisa o lotérico no WhatsApp pessoal.
- **Frontend (`js/app.js` módulo `COTAS`)**:
  - Admin: menu Admin → **🎟️ Cotas ao Vivo** (tela `lotes`) — criar lote (modal), acompanhar ao
    vivo (cronômetro, X/N, grid de cotas com nome/status), **confirmar/liberar** cada cota, ver
    comprovante, popup a cada venda. Polling de 3s + cronômetro de 1s.
  - Cliente: nav **🎟️ Cotas** (tela `cotas`) + banner no Início quando há lote ativo — escolher
    cota, reservar (nome pré-preenchido), anexar comprovante (base64), contador e aviso de 50%.
  - Cota do cliente é lembrada em `localStorage['ltr_minhas_cotas']` (ele não tem login/token).

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
- Admin dashboard — total vendido, bolões, grupos, apostadores (real + estimativa), ticket médio
- Cadastro de apostadores do grupo — independente de bolão, adicionar manual ou colar lista
- Apostadores — visão unificada app + bolões + grupo, dar acesso, registrar todos, telefone editável
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
