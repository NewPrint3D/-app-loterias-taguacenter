# App de Loterias — Lotérica Taguacenter

App de gestão de bolões para lotérica física (Taguacenter, Brasília).
Frontend client-side + backend Node.js (Express) no Render + banco Neon PostgreSQL.
Dados persistidos no Neon via API REST — sincroniza entre dispositivos/países.
Sempre responder e escrever código em **português** (variáveis, funções, strings de UI, comentários).

## Como rodar localmente

```
cd C:\Users\User\Downloads\apploterias
python -m http.server 8181
```

Abrir `http://localhost:8181` no navegador.

## Estrutura do projeto

```
index.html          — telas, modais e shell do app
css/style.css       — estilos e tema escuro
js/config.js        — configurações centrais (APP, LOTERIAS, CREDS, MOCK, FRASES_ZE)
js/app.js           — toda a lógica: estado, auth, DB, router, views, WhatsApp, Dev
img/logo.png        — logo da Lotérica Taguacenter
img/ze-loteca.png   — mascote Zé Loteca
server/server.js    — API REST Express + Neon PostgreSQL
server/package.json — dependências do backend
server/schema.sql   — schema das 7 tabelas Neon (referência)
```

## Acessos / credenciais

| Perfil   | Nome no login | Senha              | Acesso |
|----------|---------------|--------------------|--------|
| Admin    | `admin`       | `admin123`         | Nav completa: Início, Bolões, Result., Admin, Conta |
| Dev      | `dev`         | `dev@zeloteca2024` | Igual admin + menu Controle Dev |
| Cliente  | qualquer nome | (sem senha)        | Digita nome + grupo do bolão → Nav: Início, Zé Loteca, Conta |

> Dev também pode ser acessado com 7 taps rápidos no logo do header (modo oculto).

## Loterias suportadas

| Loteria       | Dezenas | Max | Preço  | Dias |
|--------------|---------|-----|--------|------|
| Mega-Sena    | 6       | 60  | R$5,00 | Quarta e Sábado |
| Quina        | 5       | 80  | R$2,50 | Segunda a Sábado |
| Lotofácil    | 15      | 25  | R$3,00 | Segunda a Sábado |
| Lotomania    | 20      | 100 | R$3,00 | Segunda e Quinta |
| Timemania    | 10      | 80  | R$3,50 | Ter, Qui e Sáb |
| Dupla Sena   | 6       | 50  | R$2,50 | Ter, Qui e Sáb |
| Dia de Sorte | 7       | 31  | R$2,50 | Terça e Sábado |

## Arquitetura principal (js/app.js)

| Módulo            | Responsabilidade |
|-------------------|-----------------|
| `S`               | Estado global + S.cache (todos os dados do Neon em memória) |
| `API_URL`         | `'https://api-loterias-taguacenter.onrender.com'` |
| `_api`            | Helper fetch para a API REST (get/post/put/del) |
| `carregarDados()` | Login async — carrega tudo do Neon, parseia NUMERIC→number |
| `DB`              | CRUD — leitura síncrona do S.cache, escrita fire-and-forget via _api |
| `AUTH`            | Login (await carregarDados), logout, verificação de role |
| `SEED`            | Dados demo — só roda se Neon estiver vazio |
| `API`             | Resultados Caixa: allorigins.win → corsproxy.io → MOCK |
| `IA`              | Análise estatística de frequência (quentes/frios) |
| `ZE`              | Mascote Zé Loteca (frases + bola número 13 animada) |
| `MODAL`           | Abre/fecha modal genérico |
| `R`               | Router + render de todas as views |
| `WPP`             | WhatsApp Manager (clipboard, sem navigator.share) |
| `CARTELA`         | Upload/download cartela (imagem/vídeo/PDF) |
| `DEV`             | Painel dev: bloquear, licença, logs, reset async (deleta do Neon) |

## Banco de dados — Neon PostgreSQL (7 tabelas)

```
grupos     — id, nome, link, membros, ativo
boloes     — id, loteria, nome, grupo, cotas_total, valor_cota, concurso, status, numeros(JSONB), criado
membros    — id, bolao_id (FK→boloes CASCADE), nome, fone, cotas, pago
vendas     — id, bolao_id, loteria, membro, cotas, valor, data
pagamentos — id, bolao_id, membro, concurso, img, data, status
usuarios   — id, nome, ativo, criado
config     — id=1 (única linha), bloqueado, msg, cliente, licenca, validade, logs(JSONB)
```

> IMPORTANTE: PostgreSQL retorna NUMERIC como string JS. carregarDados() converte com `+valor`.

## API de resultados da Caixa

```
Base: https://servicebus2.caixa.gov.br/portaldeloterias/api/
A Caixa bloqueia IPs de servidor (403) — chamada é feita client-side com proxies:
  1º: https://api.allorigins.win/get?url=<encoded> → resposta em {contents:"..."}
  2º: https://corsproxy.io/?url=<encoded>           → fallback
  3º: MOCK local (config.js)                         → fallback final
```

## Deploy — App Online

**URL Frontend:** https://app-loterias-taguacenter.onrender.com
**URL Backend:** https://api-loterias-taguacenter.onrender.com
**Banco de dados:** Neon PostgreSQL — schema em `server/schema.sql`
**GitHub:** https://github.com/NewPrint3D/-app-loterias-taguacenter

### Como atualizar após mudanças

```
git add .
git commit -m "descrição"
git push
```

## Funcionalidades implementadas (estado em 27/06/2026)

- Splash screen + bola número **13** animada
- Login com "⏳ Conectando..." enquanto carrega Neon
- Home admin: cards com prêmio ao vivo
- Home cliente: saudação, grupo, WhatsApp, resultados, quentes/frios
- Zé Loteca: frases + bola **13** no nav
- Bolões: listar, criar, detalhe (Resultados / IA / Membros)
- Membros: toggle pago/pendente, envio comprovante
- Gerador IA: 40% quentes + 20% frios + aleatório
- Resultados gerais: todas as loterias
- Admin dashboard: total vendido, bolões, apostadores, ticket médio
- WhatsApp Manager: mensagem, clipboard, envio por grupo/participante (sem navigator.share)
- Cartela: drag-and-drop, preview, download
- Estatísticas: filtros **7d / 15d / 30d / Tudo / Personalizado**, por cliente/grupo/loteria, Chart.js
- Pagamentos/Comprovantes: envio e aprovação
- Usuários: cadastrar, ativar/desativar, remover
- Grupos WhatsApp: link de convite + membros
- Perfil: info + logout
- Painel Dev: bloquear app, licença, logs, reset async
- Tela manutenção: exibida para clientes bloqueados

## Próximos passos pendentes

1. **Domínio** — subdomínio em `wvstudio3d.com` ou comprar `apploteriastaguacenter.com`
2. **Baileys bot** — import membros do grupo WhatsApp + envio automático (chip dedicado pré-pago + QR scan pelo admin)

## Dados de teste

- `C:\Users\User\Downloads\comprovante para teste app loterias.jpeg`
- `C:\Users\User\Downloads\comprovante para teste app loterias (1).jpeg`
