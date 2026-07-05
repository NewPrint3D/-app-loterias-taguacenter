-- Schema do App Loterias Taguacenter
-- Execute no Neon SQL Editor para criar/recriar as tabelas

CREATE TABLE IF NOT EXISTS grupos (
  id      TEXT PRIMARY KEY,
  nome    TEXT NOT NULL,
  link    TEXT DEFAULT '',
  membros INTEGER DEFAULT 0,
  ativo   BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS boloes (
  id          TEXT PRIMARY KEY,
  loteria     TEXT NOT NULL,
  nome        TEXT NOT NULL,
  grupo       TEXT DEFAULT '',
  grupo_id    TEXT REFERENCES grupos(id) ON DELETE SET NULL,
  cotas_total INTEGER DEFAULT 10,
  valor_cota  NUMERIC DEFAULT 0,
  concurso    INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'ativo',
  numeros     JSONB DEFAULT '[]',
  criado      TEXT DEFAULT '',
  resultado   JSONB
);

CREATE TABLE IF NOT EXISTS membros (
  id       TEXT PRIMARY KEY,
  bolao_id TEXT REFERENCES boloes(id) ON DELETE CASCADE,
  nome     TEXT NOT NULL,
  fone     TEXT DEFAULT '',
  cotas    INTEGER DEFAULT 1,
  pago     BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS vendas (
  id       TEXT PRIMARY KEY,
  bolao_id TEXT,
  loteria  TEXT,
  membro   TEXT,
  cotas    INTEGER DEFAULT 1,
  valor    NUMERIC DEFAULT 0,
  data     TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id       TEXT PRIMARY KEY,
  bolao_id TEXT,
  membro   TEXT,
  concurso INTEGER DEFAULT 0,
  img      TEXT,
  data     TEXT DEFAULT '',
  status   TEXT DEFAULT 'pendente'
);

CREATE TABLE IF NOT EXISTS usuarios (
  id     TEXT PRIMARY KEY,
  nome   TEXT NOT NULL,
  ativo  BOOLEAN DEFAULT TRUE,
  criado TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS config (
  id       INTEGER PRIMARY KEY DEFAULT 1,
  bloqueado BOOLEAN DEFAULT FALSE,
  msg      TEXT DEFAULT '',
  cliente  TEXT DEFAULT 'Demo',
  licenca  TEXT DEFAULT 'DEMO-2024',
  validade TEXT DEFAULT '2025-12-31',
  logs     JSONB DEFAULT '[]',
  admin_fone TEXT DEFAULT '',
  CONSTRAINT config_single_row CHECK (id = 1)
);

-- Garante que existe exatamente uma linha de config
INSERT INTO config(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
