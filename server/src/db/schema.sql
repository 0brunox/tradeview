-- OHLCV candles cache. One row per (symbol, interval, candle-open).
CREATE TABLE IF NOT EXISTS candles (
  symbol    TEXT             NOT NULL,
  interval  TEXT             NOT NULL,
  open_time BIGINT           NOT NULL,   -- ms since epoch, candle open
  open      DOUBLE PRECISION NOT NULL,
  high      DOUBLE PRECISION NOT NULL,
  low       DOUBLE PRECISION NOT NULL,
  close     DOUBLE PRECISION NOT NULL,
  volume    DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (symbol, interval, open_time)
);

CREATE INDEX IF NOT EXISTS idx_candles_lookup
  ON candles (symbol, interval, open_time DESC);
