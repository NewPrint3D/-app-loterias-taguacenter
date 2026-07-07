# Temas Sazonais — App Loterias Taguacenter
> Implementado em 29/06/2026

## O que é

Sistema de temas visuais sazonais para o admin decorar o app conforme as datas especiais da Caixa Econômica Federal.
Selecionado no painel **Admin → 🎨 Tema Visual**. Persiste automaticamente para todos os usuários (admin e clientes).

---

## Os 10 Temas

| Emoji | Tema | Data | Cores principais |
|-------|------|------|-----------------|
| 🎰 | **Padrão** | Sempre | Verde/azul escuro (original) |
| 🎆 | **Mega da Virada** | 31 de Dezembro | Dourado/preto |
| 🎪 | **Quina de São João** | Festa Junina · Junho | Laranja/vermelho/amarelo |
| 🐣 | **Mega de Páscoa** | Semana Santa · Mar/Abr | Roxo/lilás/dourado |
| 🇧🇷 | **Lotofácil Independência** | 7 de Setembro | Verde/amarelo/azul |
| 🎄 | **Natal** | Dezembro | Verde-florestal/vermelho/dourado |
| 🌸 | **Mega Dia das Mães** | 2º Dom de Maio | Rosa/pink |
| 👔 | **Mega Dia dos Pais** | 2º Dom de Agosto | Azul/dourado |
| 🎈 | **Mega Dia das Crianças** | 12 de Outubro | Laranja/multicolorido |
| ⚽ | **Copa / Timemania** | Temporada de Futebol | Verde-escuro/amarelo |

---

## Efeitos Visuais por Tema

### Efeitos comuns (todos os temas, exceto Padrão)
- **Faixa festiva** abaixo do header com nome e data do tema
- **Glow pulsante** no header, nav e logo — cor do tema
- **35 partículas** flutuantes animadas com emojis do tema
- **Overlay de gradiente** no fundo da tela
- **Brilho deslizante** (shimmer) na faixa festiva

### Efeitos únicos por tema
| Tema | Efeito especial |
|------|----------------|
| 🎪 São João | **Bandeirinhas coloridas** no topo (vermelho/verde/amarelo/roxo/laranja) |
| 🎄 Natal | **Faixa listrada** vermelho/verde no topo + partículas **caindo** (neve) |
| ⚽ Copa | **Faixa listrada** verde/amarelo no topo |
| 🇧🇷 Independência | **Faixa listrada** verde/amarelo/azul (cores da bandeira) |
| 🐣 Páscoa | Partículas em **queda suave** (pétalas/ovos) |
| 🌸 Mães | Partículas em **queda suave** (flores/pétalas) |

### Animações de partículas
| Código | Movimento | Usado em |
|--------|-----------|---------|
| `anim-a` | Subida simples com rotação | Maioria dos temas |
| `anim-b` | **Zigzag** sobe oscilando | São João, Copa, Virada |
| `anim-c` | **Espiral** sobe girando | Crianças, Pais |
| `anim-d` | **Queda lenta** de cima para baixo | Natal, Mães, Páscoa |

---

## Arquivos Modificados

### `js/config.js`
Adicionado o objeto `TEMAS` com os 10 temas antes do `MOCK`:
```js
const TEMAS = {
  padrao:      { id, nome, emoji, desc, decos:[], cores:{bg, bg2, bg3, primary, gold, border} },
  mega_virada: { ... decos:['✨','🎆','🎇','🥂','🎊','⭐'], ... },
  sao_joao:    { ... decos:['🎪','🌽','🔥','⭐','🎊','🎆'], ... },
  // ... outros 7 temas
};
```

### `css/style.css`
Adicionada a seção **TEMAS SAZONAIS** com:
- Variáveis `body[data-tema="..."]` para cada tema
- Glow por tema: `box-shadow` colorido pulsante em `#header`, `#nav-admin`, `#nav-user`
- Halo no logo: `.h-logo-img` com `box-shadow` animado
- Estilos da `#faixa-tema` + efeito shimmer
- Decorações únicas por tema (bandeirinhas, listras) via CSS `::before`
- 4 keyframes de partículas: `decoA`, `decoB`, `decoC`, `decoD`
- Seletor de tema: `.tema-grid`, `.tema-card`, `.tema-card-emoji`, `.tema-dot`

### `js/app.js`
Módulo `TEMA` adicionado antes da INICIALIZAÇÃO:
```js
const TEMA = {
  _key: 'ltr_tema',
  atual()           // lê localStorage
  aplicar(id)       // aplica tema, faixa, partículas, meta-color, re-renderiza admin
  carregar()        // chamado no DOMContentLoaded (antes do login)
  _atualizarFaixa(t)     // mostra/esconde a faixa festiva
  _iniciarParticulas(t)  // cria 35 partículas com animação por tema
  _pararParticulas()     // limpa partículas
  renderSeletor()        // HTML do seletor de tema no admin
  _atualizarMetaColor()  // atualiza <meta name="theme-color">
}
```

### `index.html`
Dois elementos adicionados ao `<div id="shell">`:
```html
<div id="faixa-tema" hidden></div>   <!-- faixa festiva fixa abaixo do header -->
<div id="deco-tema" aria-hidden="true"></div>  <!-- container das partículas -->
```

---

## Como Mudar o Tema

1. Login como **admin** ou **dev**
2. Toque em **Admin** (ícone 🛠️ no nav)
3. Role para baixo até **🎨 Tema Visual**
4. Toque em qualquer card de tema
5. O app muda instantaneamente — persiste mesmo após fechar e reabrir

---

## Observações Técnicas

- Tema salvo em `localStorage` → persiste entre sessões do mesmo navegador
- `TEMA.carregar()` é chamado no `DOMContentLoaded` → tema aplicado **antes do login** (splash e login já ficam temáticos)
- `body.tem-faixa` é adicionado/removido para ajustar o `margin-top` do `#main`
- **Produção**: ainda não enviado para o GitHub/Render (aguardando aprovação após análise local em `http://localhost:8181`)
