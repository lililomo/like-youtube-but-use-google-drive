-- Impor playlist YouTube: tiap video tetap satu baris, dengan asal playlist & urutannya.
ALTER TABLE youtube_imports
  ADD COLUMN playlist_id VARCHAR(64) NULL AFTER yt_id,
  ADD COLUMN playlist_title VARCHAR(300) NULL AFTER playlist_id,
  ADD COLUMN playlist_index INT UNSIGNED NULL AFTER playlist_title,
  ADD KEY idx_playlist (playlist_id);
