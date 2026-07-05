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
// JWT — expira em 1h sem uso, com renovação deslizante
// =============================================
// JWT_SECRET vem de env var no Render. Fallback fixo só pra não travar o dev local
// (não regenerar aleatório aqui — isso invalidaria todas as sessões a cada restart do servidor).
const JWT_SECRET = process.env.JWT_SECRET || 'apploterias-taguacenter-dev-secret-local';
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET não definido — usando fallback fixo. Configure a env var no Render (senão qualquer um que veja este código pode forjar tokens de admin).');
}
const JWT_EXPIRES_IN = '1h';
const assinarToken = role => jwt.sign({ role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

// Rotas de escrita usadas por quem não tem login (cliente sem senha) — ficam de fora do gate.
// Toda rota pública nova precisa ser adicionada aqui E comentada no próprio app.post/put dela.
const ROTAS_ESCRITA_PUBLICAS = new Set(['/api/auth/login', '/api/pagamentos', '/api/config/log']);

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  if (ROTAS_ESCRITA_PUBLICAS.has(req.path)) return next();
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
      return (d && Array.isArray(d.listaDezenas) && d.listaDezenas.length) ? d : null;
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
  const { id, grupo_id, nome, fone, criado } = req.body;
  try {
    await pool.query(
      `INSERT INTO grupo_membros(id,grupo_id,nome,fone,criado) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET nome=$3,fone=$4`,
      [id, grupo_id, nome, fone||'', criado||'']
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

app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

async function pgAuthState() {
  await pool.query(`CREATE TABLE IF NOT EXISTS wpp_auth (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`);
  const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');

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
    } = require('@whiskeysockets/baileys');
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
          const senderJid = msg.key.participant || groupJid;
          const fone = senderJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');

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
            `INSERT INTO usuarios(id, nome, ativo, criado) VALUES($1,$2,true,$3)`,
            [novoId, nome, hoje]
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
        const { DisconnectReason: DR } = require('@whiskeysockets/baileys');
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

app.get('/api/wpp/qr', (req, res) => {
  if (!botQr) {
    return res.send(`<html><body style="background:#0d1117;color:#fff;font-family:sans-serif;text-align:center;padding:40px">
      <h2>Status: ${botStatus}</h2>
      <p>QR ainda não disponível. Aguarde e <a href="/api/wpp/qr" style="color:#4ade80">recarregue</a>.</p>
    </body></html>`);
  }
  res.send(`<html><body style="background:#0d1117;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0">
    <p style="color:#fff;font-family:sans-serif;margin-bottom:16px;font-size:1.1rem">📱 WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
    <img src="${botQr}" style="width:280px;height:280px;border-radius:12px;background:#fff;padding:8px">
    <p style="color:#888;font-family:sans-serif;font-size:12px;margin-top:16px">
      Status: ${botStatus} · <a href="/api/wpp/qr" style="color:#4ade80">Atualizar QR</a>
    </p>
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
  try {
    await pool.query('UPDATE grupos SET jid=$1 WHERE id=$2', [req.body.jid || '', req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wpp/enviar', async (req, res) => {
  if (!botSock || botStatus !== 'conectado')
    return res.status(503).json({ error: 'Bot não conectado' });
  const { targets, mensagem, imagem } = req.body;
  if (!Array.isArray(targets) || !targets.length || !mensagem)
    return res.status(400).json({ error: 'Parâmetros inválidos' });

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
    await new Promise(r => setTimeout(r, 3000));
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
_migracaoGrupoId.finally(() => {
  app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
});
