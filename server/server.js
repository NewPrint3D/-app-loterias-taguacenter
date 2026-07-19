'use strict';
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Render fica atrás de proxy — necessário para req.ip correto
// X-Token-Renovado precisa estar exposto, senão o navegador não deixa o front ler o header
app.use(cors({ exposedHeaders: ['X-Token-Renovado'] }));
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Normaliza telefone pra só dígitos com DDI 55 (espelha normalizarFone() do frontend)
function normalizarFoneServidor(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return d;
}

// ---- HEALTH ----
app.get('/api/health', (req, res) => res.json({ ok: true }));

// =============================================
// JWT — expira em 24h sem uso, com renovação deslizante
// =============================================
// JWT_SECRET vem de env var no Render. Fallback fixo só pra não travar o dev local
// (não regenerar aleatório aqui — isso invalidaria todas as sessões a cada restart do servidor).
const JWT_SECRET = process.env.JWT_SECRET || 'apploterias-taguacenter-dev-secret-local';
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET não definido — usando fallback fixo. Configure a env var no Render (senão qualquer um que veja este código pode forjar tokens de admin).');
}
const JWT_EXPIRES_IN = '24h';
const assinarToken = role => jwt.sign({ role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

// Rotas de escrita usadas por quem não tem login (cliente sem senha) — ficam de fora do gate.
// Toda rota pública nova precisa ser adicionada aqui E comentada no próprio app.post/put dela.
const ROTAS_ESCRITA_PUBLICAS = new Set(['/api/auth/login', '/api/pagamentos', '/api/config/log', '/api/usuarios/registrar', '/api/bolao-parcelado-pagamentos']);

// Cliente (nome+telefone, sem token) reserva a cota e anexa o comprovante -- essas duas rotas de
// cota precisam ficar publicas. Reservar e atomico (so pega se estiver 'livre') e anexar so
// funciona numa cota ja reservada, entao abrir nao deixa ninguem marcar cota como paga (isso e
// rota protegida /confirmar). Confirmar premiacao tambem e publica pelo mesmo motivo (cliente sem
// token) -- so marca confirmada=true numa premiacao ja existente, nao cria nem altera valor.
function ehRotaEscritaPublica(path) {
  if (ROTAS_ESCRITA_PUBLICAS.has(path)) return true;
  if (/^\/api\/cotas\/[^/]+\/(reservar|comprovante)$/.test(path)) return true;
  if (/^\/api\/premiacoes\/[^/]+\/confirmar$/.test(path)) return true;
  if (/^\/api\/bolao-parcelado-participantes\/[^/]+\/quitacao$/.test(path)) return true;
  if (path === '/api/bolao-parcelado-mensagens') return true; // apostador sem token envia mensagem ao admin
  return false;
}

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  if (ehRotaEscritaPublica(req.path)) return next();
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'Sessão expirada. Faça login novamente.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    res.setHeader('X-Token-Renovado', assinarToken(payload.role)); // renovação deslizante
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Sessão expirada. Faça login novamente.' });
  }
});

// ---- AUTH (admin / dev) ----
// Hashes vêm de env vars no Render (ADMIN_SENHA_HASH / DEV_SENHA_HASH).
// Fallback local só para não quebrar o dev local — gerar hash: bcrypt.hashSync('senha', 10)
const _loginHashes = {
  admin: process.env.ADMIN_SENHA_HASH || bcrypt.hashSync('admin123', 10),
  dev:   process.env.DEV_SENHA_HASH   || bcrypt.hashSync('dev@zeloteca2024', 10),
};
const _loginNomes = { admin: 'Administrador', dev: 'Desenvolvedor' };
const _loginTentativas = new Map(); // ip -> { falhas, bloqueadoAte }

app.post('/api/auth/login', async (req, res) => {
  const { login, senha } = req.body || {};
  const ip = req.ip;
  const agora = Date.now();
  const t = _loginTentativas.get(ip);
  if (t?.bloqueadoAte > agora) {
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const hash = _loginHashes[login];
  if (!hash || typeof senha !== 'string') {
    return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
  }
  const valido = await bcrypt.compare(senha, hash);
  if (!valido) {
    const falhas = (t?.falhas || 0) + 1;
    _loginTentativas.set(ip, { falhas, bloqueadoAte: falhas >= 5 ? agora + 5 * 60 * 1000 : 0 });
    return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
  }
  _loginTentativas.delete(ip);
  res.json({ ok: true, role: login, nome: _loginNomes[login], token: assinarToken(login) });
});

// Headers de navegador — a Caixa bloqueia (403) requisições sem eles vindas de servidor
const CAIXA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer': 'https://loterias.caixa.gov.br/Paginas/Mega-Sena.aspx',
  'Origin': 'https://loterias.caixa.gov.br',
};
const CAIXA_TIMEOUT_MS_EXIBICAO = 10000;

// Converte a resposta da loteriascaixa-api pro formato bruto da Caixa (o mesmo que o frontend já
// sabe interpretar) — assim o frontend não precisa saber de onde veio o dado.
function paraFormatoCaixaBruto(d) {
  return {
    numero: d.concurso,
    dataApuracao: d.data,
    listaDezenas: d.dezenas,
    listaTrevos: d.trevos || [],
    acumulado: !!d.acumulou,
    listaRateioPremio: (d.premiacoes || []).map(f => ({
      descricaoFaixa: f.descricao, faixa: f.faixa,
      numeroDeGanhadores: f.ganhadores, valorPremio: f.valorPremio,
    })),
    valorEstimadoProximoConcurso: d.valorEstimadoProximoConcurso || 0,
    dataProximoConcurso: d.dataProximoConcurso || null,
    numeroConcursoProximo: d.proximoConcurso || null,
  };
}

// Cadeia de fontes pra exibição de resultados (home, resultados, IA, histórico) — diferente da
// cadeia usada pela conferência automática porque aqui PRECISA preservar os campos do próximo
// concurso (número, data, prêmio estimado), que a conferência descarta por não precisar deles.
// allorigins/corsproxy não entram aqui: já não funcionam de servidor (ver conferência automática),
// e não devem rodar do navegador tampouco — por isso o frontend passou a chamar esta rota em vez
// de tentar os proxies ele mesmo (causava resultados desatualizados/mock quando os proxies falhavam).
const FONTES_EXIBICAO = [
  {
    nome: 'guidi',
    buscar: async (loteria, concurso) => {
      const r = await fetch(`https://api.guidi.dev.br/loteria/${loteria}/${concurso || 'ultimo'}`, { signal: AbortSignal.timeout(CAIXA_TIMEOUT_MS_EXIBICAO) });
      if (!r.ok) return null;
      const d = await r.json();
      return (d && Array.isArray(d.listaDezenas) && d.listaDezenas.length) ? d : null;
    },
  },
  {
    nome: 'loteriascaixa-api',
    buscar: async (loteria, concurso) => {
      const r = await fetch(`https://loteriascaixa-api.herokuapp.com/api/${loteria}/${concurso || 'latest'}`, { signal: AbortSignal.timeout(CAIXA_TIMEOUT_MS_EXIBICAO) });
      if (!r.ok) return null;
      const d = await r.json();
      return (d && Array.isArray(d.dezenas) && d.dezenas.length) ? paraFormatoCaixaBruto(d) : null;
    },
  },
  {
    nome: 'caixa-direto',
    buscar: async (loteria, concurso) => {
      const url = `https://servicebus2.caixa.gov.br/portaldeloterias/api/${loteria}/${concurso || ''}`;
      const r = await fetch(url, { headers: CAIXA_HEADERS, signal: AbortSignal.timeout(CAIXA_TIMEOUT_MS_EXIBICAO) });
      if (!r.ok) return null;
      const d = await r.json();
      if (!d) return null;
      if (Array.isArray(d.listaDezenas) && d.listaDezenas.length) return d;
      return null;
    },
  },
];

async function buscarResultadoParaExibicao(loteria, concurso) {
  for (const fonte of FONTES_EXIBICAO) {
    try {
      const d = await fonte.buscar(loteria, concurso);
      if (d) return d;
    } catch (e) {
      console.log(`Exibição: fonte "${fonte.nome}" falhou pra ${loteria}/${concurso || 'último'} — ${e.message}`);
    }
  }
  return null;
}

// Cache em memória (90s) + coalescing de requisições concorrentes pra mesma chave — sem isso,
// a Home carrega 7 loterias em paralelo e cada usuário/aba aberta ao mesmo tempo multiplica as
// chamadas externas (guidi falha sempre por bloqueio de país, então tudo cai em loteriascaixa-api,
// uma API gratuita — várias pessoas abrindo o app junto poderia sobrecarregá-la sem necessidade,
// já que o resultado de um concurso não muda de um minuto pro outro).
const CACHE_EXIBICAO_TTL_MS = 90 * 1000;
const _cacheExibicao = new Map(); // chave -> { data, expiraEm }
const _emAndamentoExibicao = new Map(); // chave -> Promise (evita disparar 2 buscas iguais ao mesmo tempo)

async function buscarResultadoParaExibicaoComCache(loteria, concurso) {
  const chave = `${loteria}/${concurso || 'ultimo'}`;
  const cacheado = _cacheExibicao.get(chave);
  if (cacheado && cacheado.expiraEm > Date.now()) return cacheado.data;
  if (_emAndamentoExibicao.has(chave)) return _emAndamentoExibicao.get(chave);

  const promessa = buscarResultadoParaExibicao(loteria, concurso)
    .then(data => {
      if (data) _cacheExibicao.set(chave, { data, expiraEm: Date.now() + CACHE_EXIBICAO_TTL_MS });
      return data;
    })
    .finally(() => _emAndamentoExibicao.delete(chave));
  _emAndamentoExibicao.set(chave, promessa);
  return promessa;
}

// ---- PROXY CAIXA (usado pelo frontend pra home, resultados, IA e histórico) ----
app.get('/api/caixa/:loteria/:concurso?', async (req, res) => {
  const { loteria, concurso } = req.params;
  const data = await buscarResultadoParaExibicaoComCache(loteria, concurso);
  if (!data) return res.status(502).json({ error: 'Nenhuma fonte de resultado respondeu.' });
  res.json(data);
});

// ---- GRUPOS ----
app.get('/api/grupos', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM grupos ORDER BY nome');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/grupos', async (req, res) => {
  const { id, nome, link, membros, ativo, jid } = req.body;
  try {
    await pool.query(
      `INSERT INTO grupos(id,nome,link,membros,ativo,jid) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET nome=$2,link=$3,membros=$4,ativo=$5,jid=$6`,
      [id, nome, link||'', membros||0, ativo!==false, jid||'']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/grupos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM grupos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- CADASTRO DE APOSTADORES DO GRUPO (independente de bolão) ----
app.get('/api/grupo_membros', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM grupo_membros ORDER BY nome');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/grupo_membros', async (req, res) => {
  const { id, grupo_id, nome, fone, wpp_jid, ativo, criado } = req.body;
  try {
    await pool.query(
      `INSERT INTO grupo_membros(id,grupo_id,nome,fone,wpp_jid,ativo,criado) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET nome=$3,fone=$4,wpp_jid=$5,ativo=$6`,
      [id, grupo_id, nome, fone||'', wpp_jid||'', ativo!==false, criado||'']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/grupo_membros/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM grupo_membros WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- BOLÕES ----
app.get('/api/boloes', async (req, res) => {
  try {
    const boloes = await pool.query('SELECT * FROM boloes ORDER BY criado DESC');
    const membros = await pool.query('SELECT * FROM membros');
    const rows = boloes.rows.map(b => ({
      ...b,
      numeros: typeof b.numeros === 'string' ? JSON.parse(b.numeros || '[]') : (b.numeros || []),
      resultado: typeof b.resultado === 'string' ? JSON.parse(b.resultado) : (b.resultado || null),
      membros: membros.rows
        .filter(m => m.bolao_id === b.id)
        .map(m => ({ nome: m.nome, fone: m.fone, cotas: m.cotas, pago: m.pago, _id: m.id }))
    }));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/boloes', async (req, res) => {
  const { id, loteria, nome, grupo, grupo_id, cotas_total, valor_cota, concurso, status, numeros, criado, membros } = req.body;
  try {
    await pool.query(
      `INSERT INTO boloes(id,loteria,nome,grupo,grupo_id,cotas_total,valor_cota,concurso,status,numeros,criado)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(id) DO UPDATE SET loteria=$2,nome=$3,grupo=$4,grupo_id=$5,cotas_total=$6,valor_cota=$7,concurso=$8,
         status=CASE WHEN boloes.status='conferido' AND $9='ativo' THEN boloes.status ELSE $9 END,
         numeros=$10,criado=$11`,
      [id, loteria, nome, grupo||'', grupo_id||null, cotas_total||10, valor_cota||0, concurso||0, status||'ativo', JSON.stringify(numeros||[]), criado||'']
    );
    if (Array.isArray(membros)) {
      await pool.query('DELETE FROM membros WHERE bolao_id=$1', [id]);
      for (const m of membros) {
        await pool.query(
          'INSERT INTO membros(id,bolao_id,nome,fone,cotas,pago) VALUES($1,$2,$3,$4,$5,$6)',
          [m._id || crypto.randomUUID(), id, m.nome, m.fone||'', m.cotas||1, m.pago||false]
        );
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/boloes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM boloes WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- VENDAS ----
app.get('/api/vendas', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM vendas ORDER BY data DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vendas', async (req, res) => {
  const { id, bolao_id, loteria, membro, cotas, valor, data } = req.body;
  try {
    await pool.query(
      'INSERT INTO vendas(id,bolao_id,loteria,membro,cotas,valor,data) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, bolao_id, loteria, membro, cotas||1, valor||0, data||'']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vendas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM vendas WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- PAGAMENTOS ----
app.get('/api/pagamentos', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM pagamentos ORDER BY data DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rota pública (cliente sem login envia comprovante) — só cria, sempre como 'pendente'.
// Nunca aceita status do corpo da requisição: sem isso, qualquer um poderia aprovar
// o próprio pagamento (ou de outro) reenviando o mesmo id com status='aprovado'.
app.post('/api/pagamentos', async (req, res) => {
  const { id, bolao_id, membro, concurso, img, data } = req.body;
  try {
    await pool.query(
      `INSERT INTO pagamentos(id,bolao_id,membro,concurso,img,data,status) VALUES($1,$2,$3,$4,$5,$6,'pendente')
       ON CONFLICT(id) DO NOTHING`,
      [id, bolao_id, membro, concurso||0, img||null, data||'']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aprovar/rejeitar comprovante — ação de admin, exige token (não está em ROTAS_ESCRITA_PUBLICAS)
app.put('/api/pagamentos/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['pendente','aprovado','rejeitado'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }
  try {
    await pool.query('UPDATE pagamentos SET status=$1 WHERE id=$2', [status, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// COTAS AO VIVO — lotes de cotas com cronômetro e reserva atômica
// ============================================================

// Manda uma mensagem individual via bot (ex: avisar um apostador que o comprovante foi ignorado).
// Silencioso se o bot estiver desconectado ou sem telefone — quem chama decide se avisa o admin.
async function enviarWhatsAppIndividual(fone, texto) {
  if (!botSock || botStatus !== 'conectado' || !fone) return false;
  try {
    await botSock.sendMessage(`${fone}@s.whatsapp.net`, { text: texto });
    return true;
  } catch (e) {
    console.error('Falha ao enviar WhatsApp individual —', e.message);
    return false;
  }
}

// Posta um texto em vários grupos via bot (delay anti-ban). Devolve resultado por grupo.
async function postarNosGrupos(grupos, texto) {
  if (!botSock || botStatus !== 'conectado') return { ok: false, motivo: 'bot_desconectado' };
  const resultados = [];
  for (const g of (grupos || [])) {
    if (!g.jid) { resultados.push({ nome: g.nome, ok: false, erro: 'sem jid' }); continue; }
    try { await botSock.sendMessage(g.jid, { text: texto }); resultados.push({ nome: g.nome, ok: true }); }
    catch (e) { resultados.push({ nome: g.nome, ok: false, erro: e.message }); }
    await new Promise(r => setTimeout(r, 3000));
  }
  return { ok: true, resultados };
}

function _gruposDoLote(lote) {
  return typeof lote.grupos === 'string' ? JSON.parse(lote.grupos || '[]') : (lote.grupos || []);
}

// Verifica os marcos do lote (50% e esgotado) contando só cotas com comprovante anexado ou pagas.
// Dispara a mensagem automática nos grupos uma única vez por marco (flags aviso50/aviso_esgotado).
async function verificarMarcosLote(loteId) {
  try {
    const { rows: lr } = await pool.query('SELECT * FROM lotes WHERE id=$1', [loteId]);
    if (!lr.length) return;
    const lote = lr[0];
    const grupos = _gruposDoLote(lote);
    const { rows: cr } = await pool.query(
      `SELECT COUNT(*)::int AS vendidas FROM cotas WHERE lote_id=$1 AND status IN ('comprovante','paga')`, [loteId]
    );
    const vendidas = cr[0].vendidas;
    const total = lote.total_cotas;

    if (!lote.aviso50 && vendidas >= Math.ceil(total / 2) && vendidas < total) {
      await pool.query('UPDATE lotes SET aviso50=true WHERE id=$1', [loteId]);
      postarNosGrupos(grupos,
        `🔥 *Corra!* Já vendemos *${vendidas}/${total}* cotas do "${lote.nome}"!\nNão fique de fora — garanta a sua antes que esgote o tempo ou as cotas. 🍀`
      ).catch(() => {});
    }
    if (!lote.aviso_esgotado && vendidas >= total) {
      await pool.query(`UPDATE lotes SET aviso_esgotado=true, status='esgotado' WHERE id=$1`, [loteId]);
      postarNosGrupos(grupos,
        `✅ *COTAS ESGOTADAS!* O bolão "${lote.nome}" foi 100% vendido. Obrigado a todos! 🎉\n\n` +
        `Ficou de fora e quer garantir vaga no próximo lote? Responda com *"fiquei de fora"* — ` +
        `se juntar gente suficiente, a gente abre um novo lote! 🍀`
      ).catch(() => {});
    }
  } catch (e) { console.error('verificarMarcosLote:', e.message); }
}

// Listar todos os lotes com as cotas embutidas (admin) — o cliente usa o mesmo GET e filtra no app.
app.get('/api/lotes', async (req, res) => {
  try {
    const { rows: lotes } = await pool.query('SELECT * FROM lotes ORDER BY criado DESC');
    const { rows: cotas } = await pool.query('SELECT * FROM cotas ORDER BY numero ASC');
    const porLote = {};
    cotas.forEach(c => { (porLote[c.lote_id] = porLote[c.lote_id] || []).push(c); });
    res.json(lotes.map(l => ({ ...l, cotas: porLote[l.id] || [] })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Um lote específico + cotas — usado no polling da sala do cliente e do painel do admin.
app.get('/api/lotes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM lotes WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Lote não encontrado' });
    const { rows: cotas } = await pool.query('SELECT * FROM cotas WHERE lote_id=$1 ORDER BY numero ASC', [req.params.id]);
    res.json({ ...rows[0], cotas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Criar lote (admin) — gera N cotas 'livre', define o cronômetro e divulga nos grupos via bot.
app.post('/api/lotes', async (req, res) => {
  const { id, bolao_id, loteria, nome, concurso, total_cotas, valor_cota, duracao_min, grupos } = req.body;
  const n = parseInt(total_cotas, 10) || 0;
  if (!id || n < 1 || n > 200) return res.status(400).json({ error: 'Total de cotas inválido (1 a 200).' });
  const dur = [5, 10, 15, 30].includes(+duracao_min) ? +duracao_min : 10;
  const inicia = new Date();
  const expira = new Date(inicia.getTime() + dur * 60000);
  try {
    await pool.query(
      `INSERT INTO lotes(id,bolao_id,loteria,nome,concurso,total_cotas,valor_cota,duracao_min,inicia_em,expira_em,status,grupos,aviso50,aviso_esgotado,espera,criado)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ativo',$11,false,false,'[]',NOW()) ON CONFLICT(id) DO NOTHING`,
      [id, bolao_id || null, loteria || '', nome || 'Bolão', concurso || 0, n, valor_cota || 0, dur,
       inicia.toISOString(), expira.toISOString(), JSON.stringify(grupos || [])]
    );
    // Gera as cotas numeradas 1..N num único INSERT
    const vals = [];
    const params = [];
    for (let i = 1; i <= n; i++) {
      params.push(crypto.randomUUID(), id, i);
      vals.push(`($${params.length - 2},$${params.length - 1},$${params.length},'livre',NOW())`);
    }
    await pool.query(`INSERT INTO cotas(id,lote_id,numero,status,criado) VALUES ${vals.join(',')} ON CONFLICT(id) DO NOTHING`, params);

    // Divulga nos grupos (o acesso é dentro do app: a mensagem manda abrir o app e escolher a cota).
    const valorFmt = (+valor_cota || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const nomeLt = NOMES_LOTERIA[loteria] || loteria || '';
    const msg =
      `🎟️ *COTAS ABERTAS — ${nome}*${nomeLt ? ' · ' + nomeLt : ''}\n\n` +
      `Estão disponíveis *${n} cotas* a *R$ ${valorFmt}* cada.\n\n` +
      `👉 Abra o app *Lotérica Taguacenter*, entre com seu nome + telefone e *escolha sua cota*.\n` +
      `⏳ Depois de reservar, você tem *${dur} minutos* pra pagar e enviar o comprovante — senão a cota libera pra outra pessoa.\n\n` +
      `_Jogue com responsabilidade. Sorteios são aleatórios e auditados pela Caixa._ 🍀`;
    let aviso = { ok: false, motivo: 'sem_grupos' };
    if (Array.isArray(grupos) && grupos.length) aviso = await postarNosGrupos(grupos, msg);
    res.json({ ok: true, aviso });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/lotes/:id', async (req, res) => {
  try { await pool.query('DELETE FROM lotes WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/lotes/:id/encerrar', async (req, res) => {
  try { await pool.query(`UPDATE lotes SET status='encerrado' WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PÚBLICA — cliente reserva a cota. Atômico: só pega se ainda estiver 'livre' e o lote ativo/no prazo.
app.post('/api/cotas/:id/reservar', async (req, res) => {
  const { nome, fone } = req.body;
  if (!nome || !String(nome).trim()) return res.status(400).json({ ok: false, error: 'Informe seu nome.' });
  try {
    const { rows } = await pool.query(
      `UPDATE cotas SET status='reservada', nome=$2, fone=$3, reservada_em=NOW(),
         expira_em = NOW() + ((SELECT duracao_min FROM lotes WHERE id=cotas.lote_id) || ' minutes')::interval
       WHERE id=$1 AND status='livre'
         AND lote_id IN (SELECT id FROM lotes WHERE status='ativo')
       RETURNING *`,
      [req.params.id, String(nome).trim().slice(0, 60), normalizarFoneServidor(fone || '')]
    );
    if (!rows.length) return res.status(409).json({ ok: false, error: 'Essa cota acabou de ser reservada. Escolha outra.' });
    res.json({ ok: true, cota: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PÚBLICA — cliente anexa o comprovante à cota que reservou. Vira 'comprovante' (verde p/ ele,
// conta no X/N). O admin ainda confere e confirma manualmente (rota protegida /confirmar).
app.post('/api/cotas/:id/comprovante', async (req, res) => {
  const { img } = req.body;
  if (!img) return res.status(400).json({ ok: false, error: 'Anexe a imagem do comprovante.' });
  try {
    const { rows } = await pool.query(
      `UPDATE cotas SET status='comprovante', comprovante=$2, expira_em=NULL
       WHERE id=$1 AND status IN ('reservada','comprovante','rejeitada') RETURNING *`,
      [req.params.id, img]
    );
    if (!rows.length) return res.status(409).json({ ok: false, error: 'Reserve a cota antes de anexar o comprovante.' });
    await verificarMarcosLote(rows[0].lote_id);
    res.json({ ok: true, cota: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Admin confere o comprovante e confirma o pagamento (verde "pago" no painel).
app.put('/api/cotas/:id/confirmar', async (req, res) => {
  try {
    const { rows } = await pool.query(`UPDATE cotas SET status='paga', pago_em=NOW() WHERE id=$1 RETURNING *`, [req.params.id]);
    res.json({ ok: true, cota: rows[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin recusa o comprovante — a cota CONTINUA com o apostador (status 'rejeitada', sem
// cronômetro, o cron de expiração não toca nela) até ele reenviar outro comprovante (volta pra
// 'comprovante'), o admin aceitar mesmo assim (/confirmar) ou liberar a cota (/liberar).
app.put('/api/cotas/:id/rejeitar', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE cotas SET status='rejeitada', expira_em=NULL WHERE id=$1 AND status='comprovante' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(409).json({ ok: false, error: 'Essa cota não tem comprovante aguardando conferência.' });
    // Reabre o lote se estava esgotado — senão o apostador não vê mais a cota pra reenviar
    // (a tela do cliente só lista lotes ativos). Mesmo comportamento do /liberar.
    await pool.query(`UPDATE lotes SET status='ativo', aviso_esgotado=false WHERE id=$1 AND status='esgotado'`, [rows[0].lote_id]);
    res.json({ ok: true, cota: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin libera uma cota de volta pra venda (ex: reserva que não pagou). Reabre o lote se esgotado.
app.put('/api/cotas/:id/liberar', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE cotas SET status='livre', nome='', fone='', comprovante=NULL, reservada_em=NULL, pago_em=NULL, expira_em=NULL WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (rows.length) await pool.query(`UPDATE lotes SET status='ativo', aviso_esgotado=false WHERE id=$1 AND status='esgotado'`, [rows[0].lote_id]);
    res.json({ ok: true, cota: rows[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- USUÁRIOS ----
app.get('/api/usuarios', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM usuarios ORDER BY nome');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/usuarios', async (req, res) => {
  const { id, nome, ativo, criado, fone } = req.body;
  try {
    await pool.query(
      `INSERT INTO usuarios(id,nome,ativo,criado,fone) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET nome=$2,ativo=$3,fone=$5`,
      [id, nome, ativo!==false, criado||'', fone||'']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PÚBLICA (em ehRotaEscritaPublica) — cliente sem token se auto-registra no login (id determinístico
// 'ap_'+fone, mesmo apostador em qualquer aparelho cai na mesma linha). Upsert restrito só a
// nome/fone/ativo=true — diferente da rota admin acima, não aceita desativar nem mexer em mais nada.
app.post('/api/usuarios/registrar', async (req, res) => {
  const { id, nome, fone, criado } = req.body;
  if (!id || !nome || !fone) return res.status(400).json({ ok: false, error: 'Dados incompletos.' });
  try {
    await pool.query(
      `INSERT INTO usuarios(id,nome,ativo,criado,fone) VALUES($1,$2,true,$3,$4)
       ON CONFLICT(id) DO UPDATE SET nome=$2,fone=$4`,
      [id, String(nome).trim().slice(0, 80), criado||'', normalizarFoneServidor(fone)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- PREMIAÇÃO ----
app.get('/api/premiacoes', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM premiacoes ORDER BY criado DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin cadastra o prêmio de um apostador (por telefone) — força confirmada=false no servidor
// independente do corpo, mesmo padrão defensivo de POST /api/pagamentos.
app.post('/api/premiacoes', async (req, res) => {
  const { id, nome, fone, valor, mensagem } = req.body;
  if (!nome || !fone) return res.status(400).json({ ok: false, error: 'Informe nome e telefone.' });
  try {
    await pool.query(
      `INSERT INTO premiacoes(id,nome,fone,valor,mensagem,confirmada,criado) VALUES($1,$2,$3,$4,$5,false,NOW())`,
      [id, String(nome).trim().slice(0, 80), normalizarFoneServidor(fone), +valor || 0, mensagem || '']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PÚBLICA (em ehRotaEscritaPublica) — o apostador premiado (sem token) confirma que viu o prêmio.
app.put('/api/premiacoes/:id/confirmar', async (req, res) => {
  try {
    await pool.query(`UPDATE premiacoes SET confirmada=true, confirmada_em=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/premiacoes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM premiacoes WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- BOLÃO ANUAL/PARCELADO ----
// Devolve todos os bolões com participantes e pagamentos aninhados (mesmo padrão de /api/lotes).
app.get('/api/boloes-parcelados', async (req, res) => {
  try {
    const { rows: boloes } = await pool.query('SELECT * FROM boloes_parcelados ORDER BY criado DESC');
    const { rows: participantes } = await pool.query('SELECT * FROM bolao_parcelado_participantes ORDER BY criado ASC');
    const { rows: pagamentos } = await pool.query('SELECT * FROM bolao_parcelado_pagamentos ORDER BY mes ASC');
    const pagsPorParticipante = {};
    pagamentos.forEach(p => { (pagsPorParticipante[p.participante_id] = pagsPorParticipante[p.participante_id] || []).push(p); });
    const partsPorBolao = {};
    participantes.forEach(p => {
      (partsPorBolao[p.bolao_parcelado_id] = partsPorBolao[p.bolao_parcelado_id] || [])
        .push({ ...p, pagamentos: pagsPorParticipante[p.id] || [] });
    });
    res.json(boloes.map(b => ({ ...b, participantes: partsPorBolao[b.id] || [] })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/boloes-parcelados', async (req, res) => {
  const { id, nome, ano, valor_mensal, duracao_meses, valor_total } = req.body;
  if (!id || !nome || !ano) return res.status(400).json({ ok: false, error: 'Informe nome e ano.' });
  try {
    await pool.query(
      `INSERT INTO boloes_parcelados(id,nome,ano,valor_mensal,duracao_meses,valor_total,status,criado)
       VALUES($1,$2,$3,$4,$5,$6,'ativo',NOW())`,
      [id, String(nome).trim().slice(0, 80), +ano, +valor_mensal || 0, +duracao_meses || 12, +valor_total || 0]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/boloes-parcelados/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM boloes_parcelados WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bolao-parcelado-participantes', async (req, res) => {
  const { id, bolao_parcelado_id, nome, fone } = req.body;
  if (!id || !bolao_parcelado_id || !nome || !fone) return res.status(400).json({ ok: false, error: 'Dados incompletos.' });
  try {
    await pool.query(
      `INSERT INTO bolao_parcelado_participantes(id,bolao_parcelado_id,nome,fone,ativo,criado)
       VALUES($1,$2,$3,$4,true,NOW())`,
      [id, bolao_parcelado_id, String(nome).trim().slice(0, 80), normalizarFoneServidor(fone)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/bolao-parcelado-participantes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM bolao_parcelado_participantes WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PÚBLICA (em ehRotaEscritaPublica) — cliente sem token declara em qual mês pretende quitar tudo
// de uma vez (só grava a intenção; a confirmação de fato acontece quando o admin aprova o
// comprovante daquele mês — ver PUT /api/bolao-parcelado-pagamentos/:id/status).
app.put('/api/bolao-parcelado-participantes/:id/quitacao', async (req, res) => {
  const { mes_quitacao_previsto } = req.body;
  const mes = parseInt(mes_quitacao_previsto, 10);
  if (!mes || mes < 1 || mes > 12) return res.status(400).json({ ok: false, error: 'Mês inválido.' });
  try {
    await pool.query(`UPDATE bolao_parcelado_participantes SET mes_quitacao_previsto=$1 WHERE id=$2`, [mes, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PÚBLICA (em ehRotaEscritaPublica) — cliente sem token envia comprovante do mês. Força
// status='pendente' no servidor independente do corpo (mesmo padrão defensivo de /api/pagamentos).
// ON CONFLICT atualiza em vez de duplicar — reenviar o comprovante do mesmo mês substitui o anterior.
app.post('/api/bolao-parcelado-pagamentos', async (req, res) => {
  const { id, participante_id, mes, valor, comprovante } = req.body;
  const m = parseInt(mes, 10);
  if (!id || !participante_id || !m || m < 1 || m > 12) return res.status(400).json({ ok: false, error: 'Dados incompletos.' });
  try {
    await pool.query(
      `INSERT INTO bolao_parcelado_pagamentos(id,participante_id,mes,valor,comprovante,status,enviado_em)
       VALUES($1,$2,$3,$4,$5,'pendente',NOW())
       ON CONFLICT(participante_id,mes) DO UPDATE SET valor=$4, comprovante=$5, status='pendente', enviado_em=NOW(), confirmado_em=NULL`,
      [id, participante_id, m, +valor || 0, comprovante || null]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Admin marca vários meses como pagos de uma vez (bolão que já estava em andamento antes de
// existir no app — pagamentos presenciais/anteriores) — evita clicar mês a mês. Já entra
// diretamente como 'confirmado' (ação do próprio admin, não precisa de aprovação depois).
app.post('/api/bolao-parcelado-pagamentos/lote', async (req, res) => {
  const { participante_id, meses, valor } = req.body;
  if (!participante_id || !Array.isArray(meses) || !meses.length) {
    return res.status(400).json({ ok: false, error: 'Dados incompletos.' });
  }
  try {
    for (const mesRaw of meses) {
      const mes = parseInt(mesRaw, 10);
      if (!mes || mes < 1 || mes > 12) continue;
      await pool.query(
        `INSERT INTO bolao_parcelado_pagamentos(id,participante_id,mes,valor,status,enviado_em,confirmado_em)
         VALUES($1,$2,$3,$4,'confirmado',NOW(),NOW())
         ON CONFLICT(participante_id,mes) DO UPDATE SET valor=$4, status='confirmado', confirmado_em=NOW()`,
        [crypto.randomUUID(), participante_id, mes, +valor || 0]
      );
    }
    const { rows } = await pool.query('SELECT mes_quitacao_previsto FROM bolao_parcelado_participantes WHERE id=$1', [participante_id]);
    const mesQuitacao = rows[0]?.mes_quitacao_previsto;
    if (mesQuitacao && meses.map(m=>+m).includes(mesQuitacao)) {
      await pool.query(`UPDATE bolao_parcelado_participantes SET quitado=true, quitado_em=NOW() WHERE id=$1`, [participante_id]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Admin confirma/rejeita/reverte um comprovante mensal. Se confirmado e o mês bater com o mês de
// ---- MENSAGENS PRIVADAS apostador → admin (Bolão Anual) ----
// PÚBLICA (em ehRotaEscritaPublica) — apostador sem token envia sugestão/reclamação/dúvida.
app.post('/api/bolao-parcelado-mensagens', async (req, res) => {
  const { id, bolao_parcelado_id, participante_id, nome, fone, mensagem } = req.body || {};
  const texto = String(mensagem || '').trim().slice(0, 1000);
  if (!id || !bolao_parcelado_id || !texto) return res.status(400).json({ ok: false, error: 'Escreva a mensagem.' });
  try {
    await pool.query(
      `INSERT INTO bolao_parcelado_mensagens(id,bolao_parcelado_id,participante_id,nome,fone,mensagem,lida,criado)
       VALUES($1,$2,$3,$4,$5,$6,false,NOW()) ON CONFLICT(id) DO NOTHING`,
      [id, bolao_parcelado_id, participante_id || null, String(nome||'').slice(0,60), normalizarFoneServidor(fone||''), texto]
    );
    // Aviso instantâneo no WhatsApp do admin (config.admin_fone, o mesmo do aviso de resultados) —
    // fire-and-forget: não atrasa a resposta pro apostador; silencioso se bot/número não configurado.
    (async () => {
      const c = await pool.query('SELECT admin_fone FROM config WHERE id=1');
      const adminFone = c.rows[0]?.admin_fone;
      if (!adminFone) return;
      const bl = await pool.query('SELECT nome FROM boloes_parcelados WHERE id=$1', [bolao_parcelado_id]);
      await enviarWhatsAppIndividual(adminFone,
        `📨 *Nova mensagem de participante*\n\nBolão: ${bl.rows[0]?.nome || 'Bolão Anual'}\nDe: ${String(nome||'Sem nome')}\n\n"${texto}"\n\n_Responda pelo app (gestão do bolão) — sua resposta chega no WhatsApp do apostador._`);
    })().catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Admin responde de dentro do app (protegida pelo middleware por ser PUT): grava a resposta no
// banco (o apostador vê no histórico dele) E envia pro WhatsApp do apostador via bot.
app.put('/api/bolao-parcelado-mensagens/:id/responder', async (req, res) => {
  const resposta = String(req.body?.resposta || '').trim().slice(0, 1000);
  if (!resposta) return res.status(400).json({ ok: false, error: 'Escreva a resposta.' });
  try {
    const { rows } = await pool.query(
      `UPDATE bolao_parcelado_mensagens SET resposta=$2, respondida_em=NOW(), lida=true WHERE id=$1 RETURNING fone`,
      [req.params.id, resposta]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Mensagem não encontrada.' });
    const botOk = await enviarWhatsAppIndividual(rows[0].fone, `📨 *Resposta do administrador:*\n\n${resposta}`);
    res.json({ ok: true, whatsapp: botOk });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Com ?fone= devolve só as mensagens daquele telefone (o apostador vê as próprias);
// sem filtro exige token de admin/dev — a caixa de entrada completa é privada.
app.get('/api/bolao-parcelado-mensagens', async (req, res) => {
  try {
    const fone = normalizarFoneServidor(req.query.fone || '');
    if (fone) {
      const r = await pool.query('SELECT * FROM bolao_parcelado_mensagens WHERE fone=$1 ORDER BY criado DESC', [fone]);
      return res.json(r.rows);
    }
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    try { jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ ok: false, error: 'Sessão expirada. Faça login novamente.' }); }
    const r = await pool.query('SELECT * FROM bolao_parcelado_mensagens ORDER BY criado DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin marca a mensagem como lida (protegida pelo middleware por ser PUT).
app.put('/api/bolao-parcelado-mensagens/:id/lida', async (req, res) => {
  try { await pool.query('UPDATE bolao_parcelado_mensagens SET lida=true WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// quitação previsto do participante, marca o participante inteiro como quitado; se um pagamento
// que tinha disparado essa quitação for revertido (erro de digitação/clique do admin), desfaz.
app.put('/api/bolao-parcelado-pagamentos/:id/status', async (req, res) => {
  const { status, motivo } = req.body;
  if (!['pendente', 'confirmado', 'rejeitado'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'Status inválido.' });
  }
  try {
    const confirmadoEm = status === 'confirmado' ? 'NOW()' : 'NULL';
    const motivoRejeicao = status === 'rejeitado' ? String(motivo || '').trim().slice(0, 300) : null;
    const { rows } = await pool.query(
      `UPDATE bolao_parcelado_pagamentos SET status=$1, confirmado_em=${confirmadoEm}, motivo_rejeicao=$3 WHERE id=$2 RETURNING participante_id, mes`,
      [status, req.params.id, motivoRejeicao]
    );
    if (rows.length) {
      const { participante_id, mes } = rows[0];
      if (status === 'confirmado') {
        await pool.query(
          `UPDATE bolao_parcelado_participantes SET quitado=true, quitado_em=NOW()
           WHERE id=$1 AND mes_quitacao_previsto=$2`,
          [participante_id, mes]
        );
      } else {
        await pool.query(
          `UPDATE bolao_parcelado_participantes SET quitado=false, quitado_em=NULL
           WHERE id=$1 AND mes_quitacao_previsto=$2 AND quitado=true`,
          [participante_id, mes]
        );
      }
      // Comprovante ignorado — a observação do admin é OPCIONAL: só avisa o apostador no
      // WhatsApp se o admin escreveu algo (fire-and-forget; falha silenciosa se bot desconectado).
      // Em branco, só muda o status — sem mensagem nenhuma.
      if (status === 'rejeitado' && motivoRejeicao) {
        const part = await pool.query('SELECT fone FROM bolao_parcelado_participantes WHERE id=$1', [participante_id]);
        const fone = part.rows[0]?.fone;
        if (fone) {
          const texto = `${motivoRejeicao}\n\nPor favor, regularize quanto antes e volte a nos enviar o comprovante.`;
          enviarWhatsAppIndividual(fone, texto).catch(() => {});
        }
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ---- CONFIG ----
app.get('/api/config', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM config WHERE id=1');
    const row = r.rows[0] || {};
    if (row.logs && typeof row.logs === 'string') row.logs = JSON.parse(row.logs || '[]');
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config', async (req, res) => {
  const { bloqueado, msg, cliente, licenca, validade, admin_fone } = req.body;
  try {
    await pool.query(
      `INSERT INTO config(id,bloqueado,msg,cliente,licenca,validade,logs,admin_fone) VALUES(1,$1,$2,$3,$4,$5,'[]',$6)
       ON CONFLICT(id) DO UPDATE SET bloqueado=$1,msg=$2,cliente=$3,licenca=$4,validade=$5,admin_fone=$6`,
      [bloqueado||false, msg||'', cliente||'Demo', licenca||'DEMO-2024', validade||'2025-12-31', normalizarFoneServidor(admin_fone)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pública (em ROTAS_ESCRITA_PUBLICAS) — disparada em todo login, inclusive cliente sem token
app.post('/api/config/log', async (req, res) => {
  const { m } = req.body;
  try {
    await pool.query(`INSERT INTO config(id,bloqueado,msg,cliente,licenca,validade,logs) VALUES(1,false,'','Demo','DEMO-2024','2025-12-31','[]') ON CONFLICT(id) DO NOTHING`);
    const c = await pool.query('SELECT logs FROM config WHERE id=1');
    const logs = (c.rows[0]?.logs || []);
    logs.unshift({ m, t: Date.now() });
    await pool.query('UPDATE config SET logs=$1 WHERE id=1', [JSON.stringify(logs.slice(0,50))]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================
// WHATSAPP BOT (Baileys)
// =============================================
let botSock   = null;
let botStatus = 'desconectado'; // desconectado | conectando | aguardando_qr | conectado
let botQr     = null;

let _pinoLog;
try { _pinoLog = require('pino')({ level: 'silent' }); } catch { _pinoLog = undefined; }

// Migração: coluna jid nos grupos
pool.query(`ALTER TABLE grupos ADD COLUMN IF NOT EXISTS jid TEXT DEFAULT ''`).catch(() => {});
// Migração: WhatsApp do lotérico pra aviso instantâneo de resultado (antes de avisar os grupos)
pool.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS admin_fone TEXT DEFAULT ''`).catch(() => {});
// Migração: telefone do usuário (preenchido manualmente na importação — o WhatsApp não entrega
// telefone de participantes com privacidade ativada, então o admin digita à mão quando descobre)
pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fone TEXT DEFAULT ''`).catch(() => {});
// Migração: cadastro de apostadores do grupo, independente de bolão. Um grupo de WhatsApp é uma
// lista permanente de possíveis apostadores; um bolão é uma oferta pontual e aleatória que o
// lotérico faz pra um ou mais grupos — ninguém é obrigado a comprar, então "quem está no grupo"
// não pode depender de existir algum bolão ativo (membros só existiam presos a bolao_id).
pool.query(`CREATE TABLE IF NOT EXISTS grupo_membros (
  id       TEXT PRIMARY KEY,
  grupo_id TEXT REFERENCES grupos(id) ON DELETE CASCADE,
  nome     TEXT NOT NULL,
  fone     TEXT DEFAULT '',
  criado   TEXT DEFAULT ''
)`).catch(() => {});
// Migração: identificador WhatsApp do participante (LID ou número@s.whatsapp.net) — permite
// mandar DM e reconhecer quem é quem mesmo quando o WhatsApp esconde o telefone real (LID).
// `ativo`: participante que saiu do grupo (group-participants.update, action 'remove') vira
// inativo em vez de apagado — mantém histórico e evita recriar duplicado se ele voltar.
// Índice único PARCIAL (só quando wpp_jid não é vazio) — participantes cadastrados manualmente
// não têm wpp_jid, então vários registros com '' precisam coexistir sem conflito; mas dois
// registros do MESMO grupo com o MESMO wpp_jid real seriam duplicata de verdade (evita corrida
// entre a importação automática e os listeners messages.upsert/group-participants.update
// tentando inserir a mesma pessoa quase ao mesmo tempo — sem isso, os dois SELECTs viam "não
// existe" antes de qualquer INSERT terminar e criavam duas linhas pro mesmo participante, o que
// fazia o envio de DM mandar a mensagem duas vezes pra ela).
// As 3 statements ficam numa ÚNICA pool.query (protocolo simple query do driver `pg` executa em
// sequência na mesma conexão) — em vez de 3 chamadas separadas, que poderiam abrir conexões
// concorrentes diferentes e rodar o CREATE INDEX antes do ADD COLUMN da própria migração ter
// commitado (viraria "column wpp_jid does not exist", engolido em silêncio pelo .catch).
pool.query(`
  ALTER TABLE grupo_membros ADD COLUMN IF NOT EXISTS wpp_jid TEXT DEFAULT '';
  ALTER TABLE grupo_membros ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE;
  CREATE UNIQUE INDEX IF NOT EXISTS grupo_membros_grupo_wpp_jid_idx
    ON grupo_membros(grupo_id, wpp_jid) WHERE wpp_jid <> '';
`).catch(() => {});
// Migração: vínculo de verdade bolão→grupo (antes só existia bolões.grupo como texto livre,
// que ficava "órfão" quando o grupo era apagado ou renomeado). ON DELETE SET NULL: apagar um
// grupo não apaga os bolões vinculados, só desfaz o vínculo (o campo texto `grupo` continua
// mostrando o nome histórico).
// Diferente das outras migrações fire-and-forget acima: POST /api/boloes referencia grupo_id
// incondicionalmente em TODO INSERT/UPDATE de bolão (não só nos vinculados a grupo), então o
// servidor aguarda essa terminar antes de aceitar conexões (ver app.listen no fim do arquivo) —
// sem isso, uma requisição podendo chegar antes da coluna existir quebraria a criação de
// qualquer bolão com "column grupo_id does not exist".
const _migracaoGrupoId = pool.query(`ALTER TABLE boloes ADD COLUMN IF NOT EXISTS grupo_id TEXT REFERENCES grupos(id) ON DELETE SET NULL`)
  .catch(e => console.error('Migração crítica (grupo_id) falhou — criação de bolões pode quebrar:', e.message));

// Tabelas persistentes
pool.query(`CREATE TABLE IF NOT EXISTS wpp_auth (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`).catch(() => {});
pool.query(`CREATE TABLE IF NOT EXISTS wpp_cadastros (
  jid TEXT PRIMARY KEY,
  ativo BOOLEAN DEFAULT true,
  mensagem TEXT,
  iniciado TIMESTAMPTZ DEFAULT NOW()
)`).catch(() => {});

// ---- COTAS AO VIVO ----
// Um "lote" e uma oferta relampago de N cotas de um bolao, divulgada nos grupos com cronometro
// regressivo. Cada "cota" e um slot individual que um apostador reserva com o nome e depois anexa
// o comprovante. Reserva atomica (UPDATE ... WHERE status='livre') evita dois pegarem a mesma cota.
// Status da cota: 'livre' -> 'reservada' (so nome) -> 'comprovante' (anexou, verde p/ cliente,
// conta no X/N) -> 'paga' (admin conferiu e confirmou manualmente).
// Status do lote: 'ativo' -> 'esgotado' (100% com comprovante) ou 'encerrado' (tempo esgotou).
// IMPORTANTE: criar em ORDEM e com await — a tabela `cotas` tem FK para `lotes`, então `lotes`
// precisa existir ANTES. Antes eram 3 pool.query() em paralelo com .catch(() => {}) engolindo o
// erro: a `cotas` corria antes da `lotes` existir, falhava calada, e /api/lotes dava 500.
const _migracaoCotasAoVivo = (async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS lotes (
      id TEXT PRIMARY KEY,
      bolao_id TEXT,
      loteria TEXT DEFAULT '',
      nome TEXT DEFAULT 'Bolao',
      concurso INTEGER DEFAULT 0,
      total_cotas INTEGER NOT NULL,
      valor_cota NUMERIC DEFAULT 0,
      duracao_min INTEGER DEFAULT 10,
      inicia_em TIMESTAMPTZ DEFAULT NOW(),
      expira_em TIMESTAMPTZ,
      status TEXT DEFAULT 'ativo',
      grupos JSONB DEFAULT '[]',
      aviso50 BOOLEAN DEFAULT false,
      aviso_esgotado BOOLEAN DEFAULT false,
      espera JSONB DEFAULT '[]',
      criado TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS cotas (
      id TEXT PRIMARY KEY,
      lote_id TEXT REFERENCES lotes(id) ON DELETE CASCADE,
      numero INTEGER,
      status TEXT DEFAULT 'livre',
      nome TEXT DEFAULT '',
      fone TEXT DEFAULT '',
      comprovante TEXT,
      reservada_em TIMESTAMPTZ,
      pago_em TIMESTAMPTZ,
      criado TIMESTAMPTZ DEFAULT NOW()
    )`);
    // expira_em agora é por RESERVA individual (prazo pra pagar), não mais um prazo único do lote —
    // ver POST /api/cotas/:id/reservar e o cron de liberação automática mais abaixo.
    await pool.query(`ALTER TABLE cotas ADD COLUMN IF NOT EXISTS expira_em TIMESTAMPTZ`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cotas_lote ON cotas(lote_id)`);
    console.log('Tabelas de Cotas ao Vivo (lotes/cotas) prontas.');
  } catch (e) {
    console.error('ERRO criando tabelas de cotas ao vivo:', e.message);
  }
})();

// Casamento apostador->premiação é por telefone normalizado (fone), não por nome — mesmo
// identificador estável usado no login (S.user.fone). nome fica só pra exibição no painel do admin.
const _migracaoPremiacoes = pool.query(`CREATE TABLE IF NOT EXISTS premiacoes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  fone TEXT NOT NULL,
  valor NUMERIC DEFAULT 0,
  mensagem TEXT DEFAULT '',
  confirmada BOOLEAN DEFAULT false,
  confirmada_em TIMESTAMPTZ,
  criado TIMESTAMPTZ DEFAULT NOW()
)`).catch(e => console.error('ERRO criando tabela premiacoes:', e.message));

// ---- BOLÃO ANUAL/PARCELADO ----
// Sistema genérico de bolões com arrecadação mensal (ex: Mega da Virada): admin cria o bolão
// (valor mensal x duração), adiciona participantes, e cada um paga mês a mês OU declara que vai
// quitar tudo de uma vez num mês escolhido (mes_quitacao_previsto). Mês sempre é mês CALENDÁRIO
// (1=janeiro...12=dezembro), independente de quando o bolão começou.
const _migracaoBoloesParcelados = (async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS boloes_parcelados (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      ano INTEGER NOT NULL,
      valor_mensal NUMERIC DEFAULT 0,
      duracao_meses INTEGER DEFAULT 12,
      valor_total NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'ativo',
      criado TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bolao_parcelado_participantes (
      id TEXT PRIMARY KEY,
      bolao_parcelado_id TEXT REFERENCES boloes_parcelados(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      fone TEXT NOT NULL,
      quitado BOOLEAN DEFAULT false,
      mes_quitacao_previsto INTEGER,
      quitado_em TIMESTAMPTZ,
      ativo BOOLEAN DEFAULT true,
      criado TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bolao_parcelado_pagamentos (
      id TEXT PRIMARY KEY,
      participante_id TEXT REFERENCES bolao_parcelado_participantes(id) ON DELETE CASCADE,
      mes INTEGER NOT NULL,
      valor NUMERIC DEFAULT 0,
      comprovante TEXT,
      status TEXT DEFAULT 'pendente',
      enviado_em TIMESTAMPTZ DEFAULT NOW(),
      confirmado_em TIMESTAMPTZ,
      UNIQUE(participante_id, mes)
    )`);
    // Justificativa do admin ao ignorar/rejeitar um comprovante — enviada automaticamente pro
    // apostador via WhatsApp (ver rota PUT .../status).
    await pool.query(`ALTER TABLE bolao_parcelado_pagamentos ADD COLUMN IF NOT EXISTS motivo_rejeicao TEXT`);
    // Mensagens privadas apostador → admin (sugestão/reclamação/dúvida do bolão anual)
    await pool.query(`CREATE TABLE IF NOT EXISTS bolao_parcelado_mensagens (
      id TEXT PRIMARY KEY,
      bolao_parcelado_id TEXT REFERENCES boloes_parcelados(id) ON DELETE CASCADE,
      participante_id TEXT,
      nome TEXT DEFAULT '',
      fone TEXT DEFAULT '',
      mensagem TEXT NOT NULL,
      lida BOOLEAN DEFAULT false,
      criado TIMESTAMPTZ DEFAULT NOW()
    )`);
    // Resposta do admin à mensagem (Opção B — 19/07/2026): fica no app E vai pro WhatsApp do apostador
    await pool.query(`ALTER TABLE bolao_parcelado_mensagens ADD COLUMN IF NOT EXISTS resposta TEXT`);
    await pool.query(`ALTER TABLE bolao_parcelado_mensagens ADD COLUMN IF NOT EXISTS respondida_em TIMESTAMPTZ`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bpmsg_bolao ON bolao_parcelado_mensagens(bolao_parcelado_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bpp_bolao ON bolao_parcelado_participantes(bolao_parcelado_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bppag_part ON bolao_parcelado_pagamentos(participante_id)`);
    console.log('Tabelas de Bolão Anual/Parcelado prontas.');
  } catch (e) {
    console.error('ERRO criando tabelas de bolão parcelado:', e.message);
  }
})();

async function pgAuthState() {
  await pool.query(`CREATE TABLE IF NOT EXISTS wpp_auth (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`);
  const { BufferJSON, initAuthCreds } = await import('@whiskeysockets/baileys'); // v7 é ESM puro, sem require()

  const read = async key => {
    const r = await pool.query('SELECT valor FROM wpp_auth WHERE chave=$1', [key]);
    if (!r.rows[0]) return null;
    try { return JSON.parse(r.rows[0].valor, BufferJSON.reviver); } catch { return null; }
  };
  const write = async (key, data) => {
    const json = JSON.stringify(data, BufferJSON.replacer);
    await pool.query(`INSERT INTO wpp_auth(chave,valor) VALUES($1,$2) ON CONFLICT(chave) DO UPDATE SET valor=$2`, [key, json]);
  };
  const remove = async key => pool.query('DELETE FROM wpp_auth WHERE chave=$1', [key]);

  const creds = await read('creds') || initAuthCreds();
  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        await Promise.all(ids.map(async id => {
          const v = await read(`k_${type}_${id}`);
          if (v != null) data[id] = v;
        }));
        return data;
      },
      set: async data => {
        await Promise.all(Object.entries(data).flatMap(([cat, items]) =>
          Object.entries(items).map(([id, v]) =>
            v != null ? write(`k_${cat}_${id}`, v) : remove(`k_${cat}_${id}`)
          )
        ));
      }
    }
  };
  return { state, saveCreds: () => write('creds', state.creds) };
}

async function conectarBot() {
  try {
    const {
      default: makeWASocket,
      DisconnectReason,
      fetchLatestBaileysVersion,
      makeCacheableSignalKeyStore,
    } = await import('@whiskeysockets/baileys'); // v7 é ESM puro, sem require()
    const QR = require('qrcode');

    botStatus = 'conectando';
    const { state, saveCreds } = await pgAuthState();
    const { version } = await fetchLatestBaileysVersion();

    botSock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, _pinoLog),
      },
      logger: _pinoLog,
      printQRInTerminal: false,
      browser: ['Loterias Bot', 'Chrome', '1.0'],
      connectTimeoutMs: 60000,
      generateHighQualityLinkPreview: false,
    });

    botSock.ev.on('creds.update', saveCreds);

    // ---- LISTENER: cadastro automático por mensagem no grupo ----
    botSock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          if (msg.key.fromMe) continue;
          const groupJid = msg.key.remoteJid;
          if (!groupJid?.endsWith('@g.us')) continue; // só grupos
          const senderJid = msg.key.participant || groupJid;
          // Lazy + memoizado: só resolve o telefone (pode envolver lidMapping, mais caro) se
          // algum dos dois blocos abaixo (pushName/participantAlt OU cadastro automático) de fato
          // precisar, e no máximo uma vez por mensagem mesmo se os dois precisarem.
          let _foneRemetente = null;
          const obterFoneRemetente = async () => {
            if (_foneRemetente === null) _foneRemetente = await resolverFoneDoJid(senderJid, msg.key.participantAlt);
            return _foneRemetente;
          };

          // ---- Atualiza/cria o participante em grupo_membros a partir de pushName/participantAlt ----
          // groupMetadata (importação inicial) raramente devolve nome — pushName só chega quando a
          // pessoa manda mensagem. `participantAlt` (v7) é o JID em formato telefone quando quem
          // mandou a mensagem é identificado por LID — o Baileys já resolve isso na entrega,
          // então é uma fonte de telefone melhor (e mais barata) que chamar lidMapping toda hora.
          if (msg.pushName || msg.key.participantAlt) {
            try {
              const { rows: gRows } = await pool.query('SELECT id FROM grupos WHERE jid=$1', [groupJid]);
              if (gRows.length) {
                const grupoId = gRows[0].id;
                const fone = await obterFoneRemetente();
                const temPushName = !!msg.pushName;
                // ON CONFLICT resolve inserir-ou-atualizar num só comando atômico (evita corrida
                // com a importação/entrada no grupo tentando cadastrar a mesma pessoa junto).
                // `$7` (temPushName) trava a troca de nome pra só acontecer quando este evento tem
                // pushName de verdade — sem isso, um evento disparado só por participantAlt (sem
                // pushName) sobrescreveria um nome já capturado de volta pra "Sem nome".
                await pool.query(
                  `INSERT INTO grupo_membros(id,grupo_id,nome,fone,wpp_jid,ativo,criado) VALUES($1,$2,$3,$4,$5,true,$6)
                   ON CONFLICT (grupo_id,wpp_jid) WHERE wpp_jid <> '' DO UPDATE SET
                     ativo=true,
                     fone = CASE WHEN grupo_membros.fone='' THEN EXCLUDED.fone ELSE grupo_membros.fone END,
                     nome = CASE WHEN $7 AND (grupo_membros.nome='' OR LOWER(grupo_membros.nome)='sem nome' OR grupo_membros.nome <> EXCLUDED.nome)
                                 THEN EXCLUDED.nome ELSE grupo_membros.nome END`,
                  [crypto.randomUUID(), grupoId, msg.pushName||'Sem nome', fone, senderJid, new Date().toISOString().split('T')[0], temPushName]
                );
              }
            } catch (e) { console.error('Erro ao atualizar participante via pushName:', e.message); }
          }

          // ---- LISTA DE ESPERA "fiquei de fora" (cotas ao vivo) ----
          // Independe do cadastro automático estar ligado: quem manda "fiquei de fora" depois de um
          // lote esgotar/encerrar entra na lista de espera do lote mais recente daquele grupo, e o
          // lotérico é avisado no WhatsApp pessoal pra decidir se abre um novo lote.
          try {
            const textoEspera = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '')
              .trim().toLowerCase();
            if (/fiquei\s+de\s+fora/.test(textoEspera)) {
              const { rows: gg } = await pool.query('SELECT id FROM grupos WHERE jid=$1', [groupJid]);
              if (gg.length) {
                const { rows: lr } = await pool.query(
                  `SELECT * FROM lotes WHERE grupos::text LIKE $1 AND status IN ('esgotado','encerrado')
                   ORDER BY criado DESC LIMIT 1`, ['%"' + gg[0].id + '"%']
                );
                if (lr.length) {
                  const lote = lr[0];
                  const espera = typeof lote.espera === 'string' ? JSON.parse(lote.espera || '[]') : (lote.espera || []);
                  if (!espera.some(e => e.jid === senderJid)) {
                    const nomeE = msg.pushName || 'Interessado';
                    espera.push({ jid: senderJid, nome: nomeE, em: new Date().toISOString() });
                    await pool.query('UPDATE lotes SET espera=$2 WHERE id=$1', [lote.id, JSON.stringify(espera)]);
                    await botSock.sendMessage(groupJid, {
                      text: `📝 Anotado, *${nomeE}*! Você entrou na lista de espera do próximo lote de "${lote.nome}". Avisaremos assim que abrir. 🍀`,
                      mentions: [senderJid],
                    });
                    try {
                      const c = await pool.query('SELECT admin_fone FROM config WHERE id=1');
                      const fone = c.rows[0]?.admin_fone;
                      if (fone) await botSock.sendMessage(`${fone}@s.whatsapp.net`, {
                        text: `📝 ${nomeE} pediu "fiquei de fora" no lote "${lote.nome}". Lista de espera agora: ${espera.length} pessoa(s).`,
                      });
                    } catch {}
                  }
                  continue; // já tratou essa mensagem como "fiquei de fora"
                }
              }
            }
          } catch (e) { console.error('Lista de espera (fiquei de fora):', e.message); }

          // Verifica se este grupo está com cadastro ativo
          const cad = await pool.query(
            'SELECT 1 FROM wpp_cadastros WHERE jid=$1 AND ativo=true', [groupJid]
          );
          if (!cad.rows.length) continue;

          // Extrai texto da mensagem
          const texto = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            ''
          ).trim();

          if (!texto || texto.length < 3) continue;

          // Valida que parece um nome (letras, acentos, espaços — 3 a 60 chars)
          const eNome = /^[a-zA-ZÀ-ÿ\s]{3,60}$/.test(texto);
          const fone = await obterFoneRemetente();

          if (!eNome) {
            await botSock.sendMessage(groupJid, {
              text: `❌ Para se cadastrar, responda apenas com seu *nome completo*.\nExemplo: _João Silva_`,
              mentions: [senderJid],
            });
            continue;
          }

          const nome = texto.replace(/\s+/g, ' ');

          // Verifica se já cadastrado pelo telefone (campo fone em membros) ou pelo nome em usuarios
          const { rows: exU } = await pool.query(
            `SELECT nome FROM usuarios WHERE LOWER(nome)=LOWER($1)`, [nome]
          );
          if (exU.length) {
            await botSock.sendMessage(groupJid, {
              text: `✅ *${exU[0].nome}*, você já está cadastrado! Pode participar dos bolões da Lotérica Taguacenter. 🎰`,
              mentions: [senderJid],
            });
            continue;
          }

          // Cadastra
          const novoId = crypto.randomUUID();
          const hoje = new Date().toISOString().split('T')[0];
          await pool.query(
            `INSERT INTO usuarios(id, nome, ativo, criado, fone) VALUES($1,$2,true,$3,$4)`,
            [novoId, nome, hoje, fone]
          );

          await botSock.sendMessage(groupJid, {
            text: `🎉 *${nome}*, você foi cadastrado com sucesso!\n\nBem-vindo aos bolões da *Lotérica Taguacenter*! 🎰\nAcompanhe os resultados pelo nosso app.`,
            mentions: [senderJid],
          });
          console.log(`Cadastro automático: ${nome} (${fone}) no grupo ${groupJid}`);
        } catch (e) {
          console.error('Erro no cadastro automático:', e.message);
        }
      }
    });

    // ---- LISTENER: entrada/saída de participante nos grupos vinculados ----
    botSock.ev.on('group-participants.update', async ({ id: groupJid, participants, action }) => {
      try {
        const { rows: gRows } = await pool.query('SELECT id FROM grupos WHERE jid=$1', [groupJid]);
        if (!gRows.length) return; // grupo não vinculado a nenhum grupo do app
        const grupoId = gRows[0].id;
        const hoje = new Date().toISOString().split('T')[0];
        // v7: participants é GroupParticipant[] (objetos Contact), não mais array de JID string
        for (const p of participants) {
          if (action === 'add') {
            const { wppJid, fone, nome } = await extrairInfoParticipante(p);
            await pool.query(
              `INSERT INTO grupo_membros(id,grupo_id,nome,fone,wpp_jid,ativo,criado) VALUES($1,$2,$3,$4,$5,true,$6)
               ON CONFLICT (grupo_id,wpp_jid) WHERE wpp_jid <> '' DO UPDATE SET ativo=true`,
              [crypto.randomUUID(), grupoId, nome||'Sem nome', fone, wppJid, hoje]
            );
          } else if (action === 'remove') {
            await pool.query('UPDATE grupo_membros SET ativo=false WHERE grupo_id=$1 AND wpp_jid=$2', [grupoId, p.id]);
          }
        }
      } catch (e) { console.error('Erro no listener group-participants.update:', e.message); }
    });

    // ---- LISTENER: sincronização de contatos (nome/telefone), independente de grupo ----
    // Diferente de messages.upsert (ligado a UM grupo específico), contatos são globais — um
    // mesmo contato pode aparecer em vários grupos vinculados, então atualiza por wpp_jid em
    // qualquer linha que bater (id, lid ou telefone), não só na de um grupo.
    botSock.ev.on('contacts.upsert', async contatos => {
      for (const c of contatos) await atualizarContatoGrupoMembros(c);
    });
    botSock.ev.on('contacts.update', async contatos => {
      for (const c of contatos) await atualizarContatoGrupoMembros(c);
    });
    // Ao conectar/reconectar, o Baileys entrega um lote de contatos já conhecidos (nome salvo,
    // notify, telefone) via este evento — mesma função de sempre, só chega numa hora diferente
    // (conexão) em vez de incremental (contacts.upsert/update).
    botSock.ev.on('messaging-history.set', async ({ contacts }) => {
      for (const c of (contacts || [])) await atualizarContatoGrupoMembros(c);
    });

    botSock.ev.on('connection.update', async upd => {
      const { connection, lastDisconnect, qr } = upd;
      if (qr) {
        botQr = await QR.toDataURL(qr);
        botStatus = 'aguardando_qr';
        console.log('Bot: QR gerado');
      }
      if (connection === 'open') {
        botStatus = 'conectado';
        botQr = null;
        console.log('Bot WhatsApp conectado!');
      }
      if (connection === 'close') {
        const { DisconnectReason: DR } = await import('@whiskeysockets/baileys');
        const cod = lastDisconnect?.error?.output?.statusCode;
        botSock = null; botStatus = 'desconectado'; botQr = null;
        if (cod !== DR.loggedOut) {
          console.log('Bot: reconectando em 5s...');
          setTimeout(conectarBot, 5000);
        } else {
          console.log('Bot: deslogado — removendo credenciais');
          await pool.query('DELETE FROM wpp_auth');
        }
      }
    });
  } catch (e) {
    console.error('Bot: erro ao conectar —', e.message);
    botStatus = 'desconectado';
  }
}

// Reconecta automaticamente se houver credenciais salvas
setTimeout(async () => {
  try {
    const r = await pool.query(`SELECT 1 FROM wpp_auth WHERE chave='creds' LIMIT 1`);
    if (r.rows.length) { console.log('Credenciais WPP encontradas. Reconectando...'); conectarBot(); }
  } catch { /* tabela ainda não existe */ }
}, 3000);

// ---- ROTAS WPP BOT ----

app.get('/api/wpp/status', (req, res) => {
  res.json({ status: botStatus, qr: botQr });
});

// Página do QR com atualização automática: o QR do WhatsApp rotaciona a cada ~20-60s e cada
// código só vale UMA leitura — a página busca o status a cada 5s e troca o QR sozinha, então o
// código na tela está sempre fresco (não precisa recarregar nem clicar em nada).
app.get('/api/wpp/qr', (req, res) => {
  res.send(`<html><body style="background:#0d1117;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:sans-serif">
    <p style="color:#fff;margin-bottom:16px;font-size:1.1rem;text-align:center;padding:0 16px">📱 WhatsApp → Dispositivos vinculados → Vincular dispositivo<br>
    <span style="font-size:.8rem;color:#888">Aponte a câmera direto pra ESTA tela (não pra foto) — o QR se renova sozinho.</span></p>
    <img id="qr" src="${botQr||''}" style="width:280px;height:280px;border-radius:12px;background:#fff;padding:8px;${botQr?'':'display:none'}">
    <h2 id="st" style="color:#fff;margin-top:16px;font-size:1rem">Status: ${botStatus}</h2>
    <script>
      setInterval(async () => {
        try {
          const d = await (await fetch('/api/wpp/status')).json();
          const img = document.getElementById('qr'), st = document.getElementById('st');
          if (d.status === 'conectado') {
            img.style.display = 'none';
            st.textContent = '✅ Conectado! Pode fechar esta página.';
            st.style.color = '#4ade80';
            return;
          }
          st.textContent = 'Status: ' + d.status;
          if (d.qr) { img.src = d.qr; img.style.display = ''; }
          else { img.style.display = 'none'; }
        } catch {}
      }, 5000);
    </script>
  </body></html>`);
});

app.post('/api/wpp/conectar', (req, res) => {
  if (botStatus === 'conectado') return res.json({ ok: true, msg: 'Já conectado' });
  if (botStatus === 'conectando' || botStatus === 'aguardando_qr')
    return res.json({ ok: true, msg: 'Aguardando conexão' });
  conectarBot();
  res.json({ ok: true, msg: 'Iniciando...' });
});

app.post('/api/wpp/desconectar', async (req, res) => {
  try {
    if (botSock) { await botSock.logout().catch(() => {}); botSock = null; }
    botStatus = 'desconectado'; botQr = null;
    await pool.query('DELETE FROM wpp_auth');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resolve o telefone real (só dígitos) a partir de um JID do WhatsApp — usado em todo lugar que
// precisa de telefone (participante de grupo, remetente de mensagem, cadastro automático).
// Ordem: 1) `pnAlternativo` explícito, se já vier em formato de telefone (ex: `p.phoneNumber` do
// groupMetadata, `msg.key.participantAlt` de uma mensagem); 2) o próprio `jid`, se já for
// `@s.whatsapp.net`; 3) só então tenta `signalRepository.lidMapping.getPNForLID` (mais caro, só
// funciona se o bot já tiver alguma sessão/troca de chave com essa pessoa — não é garantido).
async function resolverFoneDoJid(jid, pnAlternativo) {
  let pn = '';
  if (pnAlternativo && String(pnAlternativo).includes('@s.whatsapp.net')) pn = String(pnAlternativo);
  if (!pn && jid && jid.endsWith('@s.whatsapp.net')) pn = jid;
  if (!pn && jid && jid.endsWith('@lid') && botSock?.signalRepository?.lidMapping?.getPNForLID) {
    try { pn = await botSock.signalRepository.lidMapping.getPNForLID(jid) || ''; }
    catch { /* sem sessão conhecida pra esse LID ainda — segue sem telefone */ }
  }
  return pn ? pn.replace('@s.whatsapp.net', '').replace(/\D/g, '') : '';
}

// Extrai identidade/telefone/nome de um participante (v7: GroupParticipant = Contact & flags de
// admin). O WhatsApp pode expor o número real via `phoneNumber` (contato não-oculto).
async function extrairInfoParticipante(p) {
  const wppJid = p.id;
  const fone = await resolverFoneDoJid(wppJid, p.phoneNumber);
  const nome = p.name || p.notify || p.verifiedName || '';
  return { wppJid, fone, nome };
}

// Atualiza nome/telefone em qualquer linha de grupo_membros cujo wpp_jid bata com este contato
// (id, lid, ou o telefone real quando exposto) — usado pelos listeners contacts.upsert/update.
// Mesma regra de sempre: nunca sobrescreve nome/telefone já preenchidos com um valor pior/vazio.
async function atualizarContatoGrupoMembros(c) {
  try {
    const foneJid = c.phoneNumber;
    const candidatos = [c.id, c.lid, foneJid].filter(Boolean);
    if (!candidatos.length) return;
    const nome = c.name || c.notify || c.verifiedName || '';
    const fone = foneJid ? foneJid.replace('@s.whatsapp.net', '').replace(/\D/g, '') : '';
    if (!nome && !fone) return; // contato sem nada de novo pra oferecer
    await pool.query(
      `UPDATE grupo_membros SET
         nome = CASE WHEN $2 <> '' AND (nome='' OR LOWER(nome)='sem nome' OR nome <> $2) THEN $2 ELSE nome END,
         fone = CASE WHEN fone='' AND $3 <> '' THEN $3 ELSE fone END
       WHERE wpp_jid = ANY($1)`,
      [candidatos, nome, fone]
    );
  } catch (e) { console.error('Erro ao sincronizar contato em grupo_membros:', e.message); }
}

// Importa/atualiza todos os participantes de um grupo WhatsApp em grupo_membros — chamado ao
// vincular um grupo do app a um wpp_jid (PUT /api/grupos/:id/jid), pelo botão manual "⬇️
// Importar" e pelo cron de backfill (a cada 6h, reforça resolução de LID/nome pendentes).
// Participante sem nome/telefone expostos entra como "Sem nome" até falar no grupo (pushName,
// ver messages.upsert) ou até o backfill conseguir resolver. Nunca sobrescreve nome/telefone já
// preenchidos (edição manual ou captura anterior) com um valor pior/vazio.
async function importarParticipantesGrupo(grupoId, wppJid) {
  if (!botSock || botStatus !== 'conectado') throw new Error('Bot não conectado.');
  const meta = await botSock.groupMetadata(wppJid);
  const hoje = new Date().toISOString().split('T')[0];
  let novos = 0;
  for (const p of meta.participants) {
    const { wppJid: jid, fone, nome } = await extrairInfoParticipante(p);
    // ON CONFLICT (índice único parcial grupo_id+wpp_jid) resolve inserir-ou-reativar num só
    // comando atômico — sem essa garantia, dois processos tentando cadastrar o mesmo participante
    // quase ao mesmo tempo (esta importação e os listeners do bot) podiam criar linha duplicada.
    // `xmax=0` no RETURNING diz se a linha foi inserida agora (não conta reativação como "novo").
    const { rows } = await pool.query(
      `INSERT INTO grupo_membros(id,grupo_id,nome,fone,wpp_jid,ativo,criado)
       VALUES($1,$2,$3,$4,$5,true,$6)
       ON CONFLICT (grupo_id,wpp_jid) WHERE wpp_jid <> '' DO UPDATE SET
         ativo=true,
         fone = CASE WHEN grupo_membros.fone='' THEN EXCLUDED.fone ELSE grupo_membros.fone END,
         nome = CASE WHEN grupo_membros.nome='' OR LOWER(grupo_membros.nome)='sem nome'
                     THEN EXCLUDED.nome ELSE grupo_membros.nome END
       RETURNING (xmax = 0) AS inserted`,
      [crypto.randomUUID(), grupoId, nome||'Sem nome', fone, jid, hoje]
    );
    if (rows[0]?.inserted) novos++;
  }
  return { total: meta.participants.length, novos };
}

app.get('/api/wpp/participantes/:jid', async (req, res) => {
  if (!botSock || botStatus !== 'conectado')
    return res.status(503).json({ ok: false, error: 'Bot não conectado. Conecte o bot no Painel Dev.' });
  try {
    const jid = decodeURIComponent(req.params.jid);
    const meta = await botSock.groupMetadata(jid);
    const participantes = meta.participants.map(p => {
      // Participantes com privacidade ativada aparecem como "@lid" (Linked ID) em vez de
      // "@s.whatsapp.net" — o WhatsApp não entrega o telefone real nesse caso pra nenhum
      // bot/app de terceiros. Sem essa checagem, os dígitos do LID eram extraídos e exibidos
      // como se fossem um telefone válido (número absurdo, sem sentido).
      const oculto = p.id.endsWith('@lid');
      return {
        jid: p.id,
        fone: oculto ? '' : p.id.replace('@s.whatsapp.net', '').replace(/\D/g, ''),
        foneOculto: oculto,
        admin: !!(p.admin),
      };
    });
    res.json({ ok: true, nome: meta.subject, participantes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/wpp/grupos-bot', async (req, res) => {
  if (!botSock || botStatus !== 'conectado') return res.json({ ok: false, grupos: [] });
  try {
    const mapa = await botSock.groupFetchAllParticipating();
    const grupos = Object.entries(mapa).map(([jid, g]) => ({
      jid, nome: g.subject, membros: g.participants?.length || 0,
    }));
    res.json({ ok: true, grupos });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.put('/api/grupos/:id/jid', async (req, res) => {
  const jid = req.body.jid || '';
  try {
    await pool.query('UPDATE grupos SET jid=$1 WHERE id=$2', [jid, req.params.id]);
    let importacao = null;
    if (jid) {
      try { importacao = await importarParticipantesGrupo(req.params.id, jid); }
      catch (e) { console.error('Importação automática ao vincular grupo falhou:', e.message); }
    }
    res.json({ ok: true, importacao });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/grupos/:id/importar', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT jid FROM grupos WHERE id=$1', [req.params.id]);
    if (!rows.length || !rows[0].jid) return res.status(400).json({ ok: false, error: 'Grupo sem vínculo com o bot ainda.' });
    const importacao = await importarParticipantesGrupo(req.params.id, rows[0].jid);
    res.json({ ok: true, importacao });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/wpp/enviar', async (req, res) => {
  if (!botSock || botStatus !== 'conectado')
    return res.status(503).json({ error: 'Bot não conectado' });
  const { targets, mensagem, imagem, broadcast } = req.body;
  if (!Array.isArray(targets) || !targets.length || !mensagem)
    return res.status(400).json({ error: 'Parâmetros inválidos' });

  // "Todos os grupos" de uma vez é o cenário de maior risco de bloqueio por spam — delay maior
  // e aleatório (8-15s) nesse caso; demais envios (grupo selecionado, DM individual) mantêm 3s.
  const resultados = [];
  for (const jid of targets) {
    try {
      if (imagem) {
        const b64 = imagem.includes(',') ? imagem.split(',')[1] : imagem;
        await botSock.sendMessage(jid, { image: Buffer.from(b64, 'base64'), caption: mensagem });
      } else {
        await botSock.sendMessage(jid, { text: mensagem });
      }
      resultados.push({ jid, ok: true });
      console.log('Bot enviou para', jid);
    } catch (e) {
      console.error('Bot: falha em', jid, e.message);
      resultados.push({ jid, ok: false, erro: e.message });
    }
    const delay = broadcast ? 8000 + Math.random() * 7000 : 3000;
    await new Promise(r => setTimeout(r, delay));
  }
  res.json({ ok: true, resultados });
});

// ---- CADASTRO AUTOMÁTICO ----

app.post('/api/wpp/iniciar-cadastro', async (req, res) => {
  if (!botSock || botStatus !== 'conectado')
    return res.status(503).json({ ok: false, error: 'Bot não conectado' });
  const { grupos, mensagem } = req.body;
  if (!Array.isArray(grupos) || !grupos.length)
    return res.status(400).json({ ok: false, error: 'Informe ao menos um grupo' });

  const msg = mensagem ||
    '👋 Olá! Para participar dos nossos bolões, responda *esta mensagem* com seu *nome completo*.\n\n' +
    'Exemplo: _João da Silva_\n\n' +
    'Você será cadastrado automaticamente! 🎰';

  const erros = [];
  for (const g of grupos) {
    try {
      await pool.query(
        `INSERT INTO wpp_cadastros(jid, ativo, mensagem) VALUES($1, true, $2)
         ON CONFLICT(jid) DO UPDATE SET ativo=true, mensagem=$2, iniciado=NOW()`,
        [g.jid, msg]
      );
      await botSock.sendMessage(g.jid, { text: msg });
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      erros.push(g.nome + ': ' + e.message);
    }
  }
  res.json({ ok: true, erros });
});

app.get('/api/wpp/status-cadastro', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT jid, ativo, mensagem, iniciado FROM wpp_cadastros WHERE ativo=true`
    );
    // Conta quantos usuarios foram cadastrados desde o início do cadastro mais recente
    const desde = rows.length ? rows.reduce((min, r) =>
      new Date(r.iniciado) < new Date(min) ? r.iniciado : min, rows[0].iniciado
    ) : null;
    let novos = 0;
    if (desde) {
      const r2 = await pool.query(
        `SELECT COUNT(*) FROM usuarios WHERE criado >= $1::date`, [desde]
      );
      novos = parseInt(r2.rows[0].count, 10);
    }
    res.json({ ok: true, ativos: rows, novos });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/wpp/encerrar-cadastro', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE wpp_cadastros SET ativo=false WHERE ativo=true RETURNING jid`
    );
    // Envia mensagem de encerramento para cada grupo
    if (botSock && botStatus === 'conectado') {
      for (const r of rows) {
        try {
          await botSock.sendMessage(r.jid, {
            text: '✅ Cadastro encerrado! Obrigado a todos que se cadastraram. Acompanhe os bolões pelo nosso app. 🎉'
          });
          await new Promise(x => setTimeout(x, 1500));
        } catch {}
      }
    }
    res.json({ ok: true, encerrados: rows.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// =============================================
// CONFERÊNCIA AUTOMÁTICA DE RESULTADOS
// =============================================
const cron = require('node-cron');

pool.query(`ALTER TABLE boloes ADD COLUMN IF NOT EXISTS resultado JSONB`).catch(() => {});

const NOMES_LOTERIA = {
  megasena: 'Mega-Sena', quina: 'Quina', lotofacil: 'Lotofácil', lotomania: 'Lotomania',
  timemania: 'Timemania', duplasena: 'Dupla Sena', diadesorte: 'Dia de Sorte',
};

const CAIXA_TIMEOUT_MS = 10000;

// ---- Normalização — cada fonte usa nomes de campo diferentes, tudo converge pra este formato:
// { concurso, data, dezenas:[...], premiacoes:[{acertos,ganhadores,premio}], acumulou }

// Formato bruto da Caixa (usado tanto pela Caixa direto quanto pelo espelho api.guidi.dev.br,
// que só repassa o JSON original da Caixa)
function normalizarCaixaBruto(d) {
  if (!d || !Array.isArray(d.listaDezenas) || !d.listaDezenas.length) return null;
  return {
    concurso: d.numero,
    data: d.dataApuracao || null,
    dezenas: d.listaDezenas,
    premiacoes: (d.listaRateioPremio || []).map(f => {
      const m = String(f.descricaoFaixa || '').match(/\d+/);
      return { acertos: m ? parseInt(m[0], 10) : null, ganhadores: f.numeroDeGanhadores || 0, premio: f.valorPremio || 0 };
    }),
    acumulou: !!d.acumulado,
  };
}

// Formato da loteriascaixa-api.herokuapp.com
function normalizarLoteriasCaixaApi(d) {
  if (!d || !Array.isArray(d.dezenas) || !d.dezenas.length) return null;
  return {
    concurso: d.concurso,
    data: d.data || null,
    dezenas: d.dezenas,
    premiacoes: (d.premiacoes || []).map(f => {
      const m = String(f.descricao || '').match(/\d+/);
      return { acertos: m ? parseInt(m[0], 10) : null, ganhadores: f.ganhadores || 0, premio: f.valorPremio || 0 };
    }),
    acumulou: !!d.acumulou,
  };
}

// Cadeia de fontes, na ordem de prioridade pedida. allorigins/corsproxy foram removidos —
// não funcionam mais a partir de servidor (allorigins caiu, corsproxy passou a bloquear
// requisições server-side no plano gratuito).
const FONTES_RESULTADO = [
  {
    nome: 'guidi',
    buscar: async (loteria, concurso) => {
      const r = await fetch(`https://api.guidi.dev.br/loteria/${loteria}/${concurso}`, { signal: AbortSignal.timeout(CAIXA_TIMEOUT_MS) });
      if (!r.ok) return null;
      return normalizarCaixaBruto(await r.json());
    },
  },
  {
    nome: 'loteriascaixa-api',
    buscar: async (loteria, concurso) => {
      const r = await fetch(`https://loteriascaixa-api.herokuapp.com/api/${loteria}/${concurso}`, { signal: AbortSignal.timeout(CAIXA_TIMEOUT_MS) });
      if (!r.ok) return null;
      return normalizarLoteriasCaixaApi(await r.json());
    },
  },
  {
    nome: 'caixa-direto',
    buscar: async (loteria, concurso) => {
      const url = `https://servicebus2.caixa.gov.br/portaldeloterias/api/${loteria}/${concurso}`;
      const r = await fetch(url, { headers: CAIXA_HEADERS, signal: AbortSignal.timeout(CAIXA_TIMEOUT_MS) });
      if (!r.ok) return null;
      return normalizarCaixaBruto(await r.json());
    },
  },
];

// Tenta cada fonte em ordem; loga qual respondeu (ou que nenhuma respondeu) pra monitorar confiabilidade
async function buscarResultadoLoteria(loteria, concurso) {
  for (const fonte of FONTES_RESULTADO) {
    try {
      const resultado = await fonte.buscar(loteria, concurso);
      if (resultado && resultado.dezenas.length && resultado.premiacoes.length) {
        console.log(`Conferência: resultado de ${loteria}/${concurso} obtido via "${fonte.nome}".`);
        return { fonte: fonte.nome, resultado };
      }
      console.log(`Conferência: fonte "${fonte.nome}" não tinha ${loteria}/${concurso} apurado ainda.`);
    } catch (e) {
      console.log(`Conferência: fonte "${fonte.nome}" falhou pra ${loteria}/${concurso} — ${e.message}`);
    }
  }
  return null; // nenhuma das 3 fontes respondeu
}

// Confere cada jogo do bolão contra as dezenas sorteadas e calcula prêmio pela faixa real
function conferirJogos(numeros, dezenasSorteadas, premiacoes) {
  const set = new Set(dezenasSorteadas);
  const jogos = numeros.map(jogo => {
    const acertos = jogo.filter(n => set.has(n)).length;
    const faixa = premiacoes.find(f => f.acertos === acertos);
    const premio = faixa && faixa.premio > 0 ? faixa.premio : 0;
    return { numeros: jogo, acertos, premio };
  });
  const maiorAcerto = jogos.reduce((m, j) => Math.max(m, j.acertos), 0);
  const premioTotal = jogos.reduce((s, j) => s + j.premio, 0);
  return { jogos, maiorAcerto, premioTotal, premiado: premioTotal > 0 };
}

const AVISO_GRUPO_DELAY_MS = 5 * 60 * 1000; // 5 minutos entre avisar o lotérico e avisar o grupo

function montarMensagemResultado(b, resultado) {
  const nomeLt = NOMES_LOTERIA[b.loteria] || b.loteria;
  const fmtMoeda = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  return resultado.premiado
    ? `🎉 PREMIADO! Bolão ${b.nome} acertou ${resultado.maiorAcerto} pontos na ${nomeLt}! Prêmio total: R$ ${fmtMoeda(resultado.premioTotal)} — R$ ${fmtMoeda(resultado.rateioPorCota)} por cota. Procure a lotérica!`
    : `📊 Resultado ${nomeLt} concurso ${b.concurso}: ${resultado.dezenas.join(' - ')}. Nosso bolão fez ${resultado.maiorAcerto} acertos. Não foi dessa vez — próximo bolão já disponível! 🍀`;
}

// Mensagem pro grupo do bolão — só sai AVISO_GRUPO_DELAY_MS depois do aviso instantâneo ao lotérico.
// Devolve true/false pro chamador saber se REALMENTE enviou (bot desconectado ou grupo sem jid
// não deve ser marcado como "enviado" — precisa poder tentar de novo no próximo minuto).
async function enviarResultadoWhatsApp(b, resultado) {
  if (!botSock || botStatus !== 'conectado') return false;
  try {
    const g = await pool.query('SELECT jid FROM grupos WHERE nome=$1', [b.grupo]);
    const jid = g.rows[0]?.jid;
    if (!jid) return false;
    await botSock.sendMessage(jid, { text: montarMensagemResultado(b, resultado) });
    return true;
  } catch (e) {
    console.error('Conferência: falha ao enviar mensagem no grupo —', e.message);
    return false;
  }
}

// Aviso instantâneo, direto no WhatsApp pessoal do lotérico — antes de qualquer grupo saber.
// É o que dá credibilidade: o dono nunca é o último a ficar sabendo do resultado do próprio bolão.
async function enviarAvisoInstantaneoAdmin(b, resultado) {
  if (!botSock || botStatus !== 'conectado') return;
  try {
    const c = await pool.query('SELECT admin_fone FROM config WHERE id=1');
    const fone = c.rows[0]?.admin_fone;
    if (!fone) return; // sem número configurado no Painel Dev — só o grupo recebe (com atraso)
    const nomeLt = NOMES_LOTERIA[b.loteria] || b.loteria;
    const msg = `🔔 Aviso instantâneo — só você viu ainda.\n\n${montarMensagemResultado(b, resultado)}\n\nO grupo "${b.grupo}" recebe esse resultado em 5 minutos.`;
    await botSock.sendMessage(`${fone}@s.whatsapp.net`, { text: msg });
  } catch (e) {
    console.error('Conferência: falha ao enviar aviso instantâneo ao admin —', e.message);
  }
}

// Aplica um resultado já normalizado a um bolão (usado tanto pelo cron quanto pelo relay do navegador).
// Ordem: 1) grava o resultado e avisa o lotérico na hora; 2) agenda o aviso do grupo pra 5 min depois
// (despachado por despacharAvisosGrupo, não por um setTimeout solto — sobrevive a um restart do servidor).
async function aplicarResultado(b, resultadoNorm, fonte) {
  const numeros = typeof b.numeros === 'string' ? JSON.parse(b.numeros || '[]') : (b.numeros || []);
  const { jogos, maiorAcerto, premioTotal, premiado } = conferirJogos(numeros, resultadoNorm.dezenas, resultadoNorm.premiacoes);
  const resultado = {
    dezenas: resultadoNorm.dezenas,
    dataApuracao: resultadoNorm.data,
    jogos, maiorAcerto, premioTotal, premiado,
    rateioPorCota: premiado ? Math.round((premioTotal / (b.cotas_total || 1)) * 100) / 100 : 0,
    conferidoEm: new Date().toISOString(),
    fonte, // qual fonte respondeu — visível na API pra monitorar confiabilidade
    avisoGrupoAgendadoPara: new Date(Date.now() + AVISO_GRUPO_DELAY_MS).toISOString(),
    avisoGrupoEnviado: false,
  };
  // status só sai de 'ativo'/'aguardando_resultado' — evita conferir duas vezes se
  // cron, gatilho manual e relay do navegador se sobrepuserem
  const upd = await pool.query(
    `UPDATE boloes SET resultado=$1, status='conferido' WHERE id=$2 AND status IN ('ativo','aguardando_resultado')`,
    [JSON.stringify(resultado), b.id]
  );
  if (!upd.rowCount) return false; // outra execução já conferiu este bolão nesse meio-tempo
  console.log(`Conferência: bolão "${b.nome}" conferido via "${fonte}" — ${maiorAcerto} acertos, premiado=${premiado}`);
  await enviarAvisoInstantaneoAdmin(b, resultado);
  return true;
}

// Roda a cada minuto: despacha pro grupo os resultados cujos 5 minutos de exclusividade do
// lotérico já passaram. Consulta o estado gravado no banco (não memória do processo), então
// sobrevive normalmente a um restart do servidor no meio da espera.
//
// Só marca avisoGrupoEnviado=true DEPOIS de confirmar que a mensagem realmente saiu — se o bot
// estiver desconectado ou o grupo não tiver jid, fica pendente e tenta de novo no próximo minuto
// (marcar antes e falhar depois faria perder o aviso pra sempre, de forma silenciosa).
// A trava _despachandoAvisos já é suficiente pra evitar envio duplicado (processo único, Node
// não roda dois ticks de cron em paralelo de verdade) — não precisa de reivindicação via SQL aqui.
let _despachandoAvisos = false;
async function despacharAvisosGrupo() {
  if (_despachandoAvisos) return; // execução anterior ainda rodando (ex: rede lenta) — evita duplicar envio
  _despachandoAvisos = true;
  try {
    // Filtra avisoGrupoEnviado=false já no SQL — sem isso a consulta cresceria sem limite
    // conforme bolões conferidos forem se acumulando ao longo do tempo.
    const boloes = (await pool.query(
      `SELECT * FROM boloes WHERE status='conferido' AND (resultado->>'avisoGrupoEnviado')='false'`
    )).rows;
    const agora = Date.now();
    for (const b of boloes) {
      const resultado = typeof b.resultado === 'string' ? JSON.parse(b.resultado) : b.resultado;
      if (!resultado.avisoGrupoAgendadoPara || new Date(resultado.avisoGrupoAgendadoPara).getTime() > agora) continue;
      const enviado = await enviarResultadoWhatsApp(b, resultado);
      if (!enviado) continue; // bot desconectado, grupo sem jid, ou falha no envio — retry no próximo minuto
      resultado.avisoGrupoEnviado = true;
      await pool.query(`UPDATE boloes SET resultado=$1 WHERE id=$2`, [JSON.stringify(resultado), b.id]);
      console.log(`Conferência: aviso do grupo "${b.grupo}" enviado (bolão "${b.nome}").`);
    }
  } catch (e) {
    console.error('Conferência: erro ao despachar avisos de grupo —', e.message);
  } finally {
    _despachandoAvisos = false;
  }
}
cron.schedule('* * * * *', despacharAvisosGrupo, { timezone: 'America/Sao_Paulo' });
// Roda uma vez no startup (com atraso pro bot ter chance de reconectar) — cobre o caso do
// servidor ter reiniciado no meio da espera de 5 minutos de algum aviso pendente.
setTimeout(despacharAvisosGrupo, 20000);

async function conferirUmBolao(b) {
  try {
    const achado = await buscarResultadoLoteria(b.loteria, b.concurso);
    // achado.resultado.concurso !== concurso: a fonte às vezes devolve o último concurso
    // conhecido em vez de erro quando o concurso pedido ainda não foi apurado
    if (!achado || achado.resultado.concurso !== b.concurso) {
      console.log(`Conferência: nenhuma fonte tinha ${b.loteria}/${b.concurso} apurado — marcando aguardando_resultado.`);
      await pool.query(
        `UPDATE boloes SET status='aguardando_resultado' WHERE id=$1 AND status IN ('ativo','aguardando_resultado')`,
        [b.id]
      );
      return;
    }
    await aplicarResultado(b, achado.resultado, achado.fonte);
  } catch (e) {
    console.error(`Conferência: erro no bolão ${b.id} —`, e.message);
  }
}

let _conferenciaRodando = false;
async function conferirBoloes() {
  if (_conferenciaRodando) {
    console.log('Conferência: já em andamento, ignorando chamada concorrente.');
    return;
  }
  _conferenciaRodando = true;
  console.log('Conferência: iniciando verificação de resultados...');
  try {
    // Reprocessa 'ativo' (nunca tentado) e 'aguardando_resultado' (as 3 fontes falharam antes)
    const boloes = (await pool.query(`SELECT * FROM boloes WHERE status IN ('ativo','aguardando_resultado')`)).rows;
    await Promise.allSettled(boloes.map(conferirUmBolao));
  } catch (e) {
    console.error('Conferência: erro ao buscar bolões —', e.message);
  } finally {
    _conferenciaRodando = false;
    console.log('Conferência: finalizada.');
  }
}

// Todo dia às 21h e 22h (horário de Brasília)
cron.schedule('0 21 * * *', conferirBoloes, { timezone: 'America/Sao_Paulo' });
cron.schedule('0 22 * * *', conferirBoloes, { timezone: 'America/Sao_Paulo' });

// ---- BACKFILL: reforça resolução de LID→telefone e nomes pendentes dos grupos vinculados ----
// Reimportar é seguro/idempotente (ON CONFLICT reativa e só melhora fone/nome quando ainda
// estavam vazios/placeholder) — então a cada 6h só roda de novo o mesmo caminho da importação
// manual, dando outra chance pro lidMapping resolver quem ainda não tinha telefone.
let _backfillRodando = false;
async function backfillGrupoMembros() {
  if (_backfillRodando || !botSock || botStatus !== 'conectado') return;
  _backfillRodando = true;
  try {
    const { rows: grupos } = await pool.query(`SELECT id, jid FROM grupos WHERE jid <> ''`);
    for (const g of grupos) {
      try { await importarParticipantesGrupo(g.id, g.jid); }
      catch (e) { console.error(`Backfill: falha no grupo ${g.id} —`, e.message); }
    }
    console.log(`Backfill: reprocessados ${grupos.length} grupo(s) vinculados.`);
  } catch (e) {
    console.error('Backfill: erro ao buscar grupos —', e.message);
  } finally {
    _backfillRodando = false;
  }
}
cron.schedule('0 */6 * * *', backfillGrupoMembros, { timezone: 'America/Sao_Paulo' });

// Liberação automática de reservas expiradas -- a cada minuto, cotas 'reservada' cujo prazo
// individual (expira_em) ja passou sem comprovante voltam pra 'livre' sozinhas, ficando disponiveis
// de novo pros outros apostadores. O lote em si nao fecha por tempo -- so por 'Encerrar agora' do
// admin ou por esgotar (100% vendido).
cron.schedule('* * * * *', async () => {
  try { await pool.query(`UPDATE cotas SET status='livre', nome='', fone='', comprovante=NULL, reservada_em=NULL, expira_em=NULL WHERE status='reservada' AND expira_em < NOW()`); }
  catch (e) { console.error('Liberação de cotas expiradas:', e.message); }
}, { timezone: 'America/Sao_Paulo' });

// Gatilho manual — força a conferência sem esperar o cron (retry manual, testes)
app.post('/api/boloes/conferir', async (req, res) => {
  try { await conferirBoloes(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Fallback final: se as 3 fontes do servidor falharem, o bolão fica "aguardando_resultado".
// O navegador do admin (que não tem o bloqueio de IP/país que o servidor tem) busca o
// resultado com os proxies de sempre e retransmite pra cá conferir e disparar as mensagens.
app.post('/api/resultados/relay', async (req, res) => {
  const { loteria, concurso, resultado } = req.body || {};
  if (!loteria || !concurso || !resultado || !Array.isArray(resultado.dezenas) || !resultado.dezenas.length
      || !Array.isArray(resultado.premiacoes) || !resultado.premiacoes.length) {
    return res.status(400).json({ ok: false, error: 'Dados de resultado incompletos ou inválidos.' });
  }
  try {
    const boloes = (await pool.query(
      `SELECT * FROM boloes WHERE loteria=$1 AND concurso=$2 AND status IN ('ativo','aguardando_resultado')`,
      [loteria, concurso]
    )).rows;
    let conferidos = 0;
    for (const b of boloes) {
      if (await aplicarResultado(b, resultado, 'relay-navegador')) conferidos++;
    }
    res.json({ ok: true, conferidos });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Só aceita conexões depois que a migração crítica (grupo_id) terminar — elimina a janela onde
// uma requisição POST /api/boloes podia chegar antes da coluna existir de verdade no banco.
Promise.all([_migracaoGrupoId, _migracaoCotasAoVivo, _migracaoPremiacoes, _migracaoBoloesParcelados]).finally(() => {
  app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
});
