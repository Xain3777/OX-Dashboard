-- Enforce at most one open cash session at a time
CREATE UNIQUE INDEX IF NOT EXISTS one_open_session
  ON cash_sessions ((status))
  WHERE status = 'open';
