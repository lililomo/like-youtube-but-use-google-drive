-- Rekomendasi personal (REKOMENDASI.md): sinyal tonton yang lebih kaya, histori tamu di server, umpan balik "Tidak tertarik".
ALTER TABLE watch_history
  ADD COLUMN max_position_sec INT UNSIGNED NOT NULL DEFAULT 0 AFTER position_sec,
  ADD COLUMN plays INT UNSIGNED NOT NULL DEFAULT 1 AFTER duration_sec,
  ADD COLUMN first_watched_at DATETIME NULL AFTER plays;
UPDATE watch_history SET max_position_sec = position_sec, first_watched_at = watched_at;

-- Histori tamu (cookie dv_gid, disimpan sebagai hash) — hanya untuk rekomendasi; halaman Histori tamu tetap dari perangkat.
CREATE TABLE guest_watch (
  guest_hash CHAR(64) NOT NULL,
  video_id BIGINT UNSIGNED NOT NULL,
  position_sec INT UNSIGNED NOT NULL DEFAULT 0,
  max_position_sec INT UNSIGNED NOT NULL DEFAULT 0,
  duration_sec INT UNSIGNED NOT NULL DEFAULT 0,
  plays INT UNSIGNED NOT NULL DEFAULT 1,
  first_watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guest_hash, video_id),
  KEY idx_guest_time (guest_hash, watched_at),
  KEY idx_time (watched_at),
  CONSTRAINT fk_gw_vid FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rec_feedback (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  guest_hash CHAR(64) NULL,
  video_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('not_interested') NOT NULL DEFAULT 'not_interested',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user (user_id, video_id, kind),
  UNIQUE KEY uq_guest (guest_hash, video_id, kind),
  KEY idx_time (created_at),
  CONSTRAINT fk_rf_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rf_vid FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
