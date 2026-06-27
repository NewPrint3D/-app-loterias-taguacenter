# App de Loterias — Lotérica Taguacenter

App de gestão de bolões para lotérica física (Taguacenter, Brasília).
Frontend client-side + backend Node.js (Express) no Render + banco Neon PostgreSQL.
Dados persistidos no Neon via API REST — sincroniza entre dispositivos/países.
Sempre responder e escrever código em **português** (variáveis, funções, strings de UI, comentários).

## Como rodar

```
cd C:\Users\User\Downloads\apploterias
python -m http.server 8181
```

Abrir `http://localhost:8181` no navegador.

## Estrutura do projeto

```
index.html        — telas, modais e shell do app
reset.html        — página de reset de dados
css/style.css     — estilos e tema escuro
js/config.js      — configurações centrais (APP, LOTERIAS, CREDS, MOCK, FRASES_ZE)
js/app.js         — toda a lógica: estado global, auth, DB, router, views, WhatsApp, Dev
img/logo.png      — logo da Lotérica Taguacenter
img/ze-loteca.png — mascote Zé Loteca
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

| Módulo    | Responsabilidade |
|-----------|-----------------|
| `S`       | Estado global (usuário, tela, bolão, charts, cache de dados, etc.) |
| `_api`    | Helper fetch para a API REST (get/post/put/del) |
| `carregarDados()` | Carrega todos os dados do Neon no login (preenche S.cache) |
| `DB`      | CRUD — leitura do cache em memória (S.cache), escrita via API + cache |
| `AUTH`    | Login, logout, verificação de role |
| `SEED`    | Dados demo iniciais (3 bolões, grupos, 50 vendas mock) |
| `API`     | Fetch da API Caixa via corsproxy.io, fallback para MOCK |
| `IA`      | Análise estatística de frequência (quentes/frios) |
| `ZE`      | Mascote Zé Loteca (frases rotativas + número animado) |
| `MODAL`   | Abre/fecha modal genérico |
| `R`       | Router + render de todas as views |
| `WPP`     | WhatsApp Manager (mensagens, envio passo a passo, share nativo) |
| `CARTELA` | Upload/download da cartela do bolão (imagem/vídeo/PDF) |
| `DEV`     | Painel de controle do desenvolvedor (bloquear app, licença, logs) |

## Funcionalidades implementadas

- **Splash screen** com logo e barra de progresso
- **Login** — admin/dev com senha; cliente com nome + grupo do bolão
- **Home admin** — cards de loterias com prêmio ao vivo da API Caixa
- **Home cliente** — saudação por hora, grupo do bolão, link WhatsApp do grupo, cards de loterias + último resultado + números quentes/frios ao vivo
- **Zé Loteca (mascote)** — frases rotativas a cada 11s, número de bola animado no nav
- **Bolões** — listar por loteria, criar novo, ver detalhes
- **Detalhe do bolão** — jogos cadastrados + 3 abas: Resultados, IA (quentes/frios), Membros
- **Membros** — lista com status de pagamento, toggle pago/pendente (admin), envio de comprovante (cliente)
- **Gerador de jogos (Zé Loteca)** — tela IA com seletor de loteria, gerador 40% quentes + 20% frios + aleatório, botão "Gerar novo jogo" com animação flip
- **Resultados gerais** — tela com último resultado de todas as loterias
- **Admin** — dashboard com totais (vendido, bolões, apostadores, ticket médio) + menu de sub-módulos
- **WhatsApp Manager** — gerador de mensagem com prêmio/data/cotas buscados da API, preview, copiar, envio passo a passo por grupo ou por participante individual, opção "Volante Pago", share nativo mobile
- **Cartela do bolão** — drag-and-drop ou seleção de arquivo (imagem/vídeo/PDF), preview, download, anexar no envio WhatsApp
- **Estatísticas** — filtros por período (7d/30d/mês/tudo/personalizado), visualização por cliente/grupo/loteria, gráfico de barras (Chart.js), ranking
- **Pagamentos/Comprovantes** — cliente envia foto do comprovante, admin aprova/rejeita, agrupado por grupo→bolão
- **Gerenciamento de usuários** — cadastrar, ativar/desativar, remover apostadores
- **Gerenciamento de grupos WhatsApp** — cadastrar grupos com link de convite e nº de membros
- **Perfil** — info do usuário logado, versão do app, botão sair
- **Painel Dev** — bloquear/desbloquear app com mensagem customizada, editar licença (cliente/validade/código), log de acessos, reset de dados
- **Tela de manutenção** — exibida para clientes quando admin bloqueia (desbloqueio via 7 taps)

## API de resultados

```
Base: https://servicebus2.caixa.gov.br/portaldeloterias/api/
Proxy CORS: https://corsproxy.io/?url=<encoded_url>
Timeout: 5 segundos → fallback para dados MOCK locais
```

Endpoints: `/{loteria}/` (último) · `/{loteria}/{concurso}` (específico)

## Deploy — App Online

**URL Frontend:** https://app-loterias-taguacenter.onrender.com (Render Static Site)
**URL Backend:** https://api-loterias-taguacenter.onrender.com (Render Web Service)
**Banco de dados:** Neon PostgreSQL (serverless) — schema em `server/schema.sql`
**Repositório GitHub:** https://github.com/NewPrint3D/-app-loterias-taguacenter
**Branch:** main

### Como atualizar o app após mudanças no código

```
git add .
git commit -m "descrição da mudança"
git push
```

O Render detecta o push e atualiza automaticamente em ~1 minuto.

## Correções feitas em 27/06/2026

- Removido `navigator.share` que abria menu do sistema com várias opções
- Envio para grupos: mensagem copiada automaticamente + arquivo baixado + abre grupo no WhatsApp
- Modal de envio simplificado

## Próximos passos pendentes

1. Domínio `wvstudio3d.com` → apontar para o Render
2. Backend WhatsApp no Render → envio automático + import de membros do grupo

## Dados de teste

Comprovantes de teste em:
- `C:\Users\User\Downloads\comprovante para teste app loterias.jpeg`
- `C:\Users\User\Downloads\comprovante para teste app loterias (1).jpeg`
