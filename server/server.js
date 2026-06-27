'use strict';
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---- HEALTH ----
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- GRUPOS ----
app.get('/api/grupos', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM grupos ORDER BY nome');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/grupos', async (req, res) => {
  const { id, nome, link, membros, ativo } = req.body;
  try {
    await pool.query(
      `INSERT INTO grupos(id,nome,link,membros,ativo) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET nome=$2,link=$3,membros=$4,ativo=$5`,
      [id, nome, link||'', membros||0, ativo!==false]
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

// ---- BOLÕES ----
app.get('/api/boloes', async (req, res) => {
  try {
    const boloes = await pool.query('SELECT * FROM boloes ORDER BY criado DESC');
    const membros = await pool.query('SELECT * FROM membros');
    const rows = boloes.rows.map(b => ({
      ...b,
      membros: membros.rows
        .filter(m => m.bolao_id === b.id)
        .map(m => ({ nome: m.nome, fone: m.fone, cotas: m.cotas, pago: m.pago, _id: m.id }))
    }));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/boloes', async (req, res) => {
  const { id, loteria, nome, grupo, cotas_total, valor_cota, concurso, status, numeros, criado, membros } = req.body;
  try {
    await pool.query(
      `INSERT INTO boloes(id,loteria,nome,grupo,cotas_total,valor_cota,concurso,status,numeros,criado)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(id) DO UPDATE SET loteria=$2,nome=$3,grupo=$4,cotas_total=$5,valor_cota=$6,concurso=$7,status=$8,numeros=$9,criado=$10`,
      [id, loteria, nome, grupo||'', cotas_total||10, valor_cota||0, concurso||0, status||'ativo', JSON.stringify(numeros||[]), criado||'']
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

// ---- PAGAMENTOS ----
app.get('/api/pagamentos', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM pagamentos ORDER BY data DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pagamentos', async (req, res) => {
  const { id, bolao_id, membro, concurso, img, data, status } = req.body;
  try {
    await pool.query(
      `INSERT INTO pagamentos(id,bolao_id,membro,concurso,img,data,status) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET status=$7`,
      [id, bolao_id, membro, concurso||0, img||null, data||'', status||'pendente']
    );
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
  const { id, nome, ativo, criado } = req.body;
  try {
    await pool.query(
      `INSERT INTO usuarios(id,nome,ativo,criado) VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET nome=$2,ativo=$3`,
      [id, nome, ativo!==false, criado||'']
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
    res.json(r.rows[0] || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config', async (req, res) => {
  const { bloqueado, msg, cliente, licenca, validade } = req.body;
  try {
    await pool.query(
      'UPDATE config SET bloqueado=$1,msg=$2,cliente=$3,licenca=$4,validade=$5 WHERE id=1',
      [bloqueado||false, msg||'', cliente||'Demo', licenca||'DEMO-2024', validade||'2025-12-31']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/log', async (req, res) => {
  const { m } = req.body;
  try {
    const c = await pool.query('SELECT logs FROM config WHERE id=1');
    const logs = (c.rows[0]?.logs || []);
    logs.unshift({ m, t: Date.now() });
    await pool.query('UPDATE config SET logs=$1 WHERE id=1', [JSON.stringify(logs.slice(0,50))]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
