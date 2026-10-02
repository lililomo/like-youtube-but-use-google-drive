-- 001_init: skema awal Dymas Video (SPEC §6). Waktu disimpan UTC.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(100) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  display_name VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  avatar_color CHAR(7) NOT NULL DEFAULT '#5c6bc0',
  storage_quota_bytes BIGINT UNSIGNED NULL,
  storage_used_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id INT UNSIGNED NOT NULL,
  remember TINYINT(1) NOT NULL DEFAULT 0,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id),
  KEY idx_exp (expires_at),
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  drive_folder_id VARCHAR(128) NOT NULL UNIQUE,
  parent_id INT UNSIGNED NULL,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(191) NOT NULL UNIQUE,
  path VARCHAR(1024) NOT NULL,
  depth TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_hidden TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  missing_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE videos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(11) NOT NULL UNIQUE,
  drive_file_id VARCHAR(128) NOT NULL UNIQUE,
  drive_parent_id VARCHAR(128) NULL,
  category_id INT UNSIGNED NULL,
  owner_user_id INT UNSIGNED NULL,
  source ENUM('drive','upload') NOT NULL DEFAULT 'drive',
  visibility ENUM('public','private') NOT NULL DEFAULT 'public',
  status ENUM('pending','processing','ready','failed','missing') NOT NULL DEFAULT 'pending',
  prev_status VARCHAR(16) NULL,
  title VARCHAR(500) NOT NULL,
  search_text VARCHAR(600) NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  mime_type VARCHAR(100) NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  md5 CHAR(32) NULL,
  duration_ms INT UNSIGNED NULL,
  width SMALLINT UNSIGNED NULL,
  height SMALLINT UNSIGNED NULL,
  rotation SMALLINT NULL,
  video_codec VARCHAR(32) NULL,
  audio_codec VARCHAR(32) NULL,
  container VARCHAR(64) NULL,
  bitrate_kbps INT UNSIGNED NULL,
  original_playable TINYINT(1) NULL,
  thumb_key CHAR(12) NULL,
  storyboard JSON NULL,
  processing_error TEXT NULL,
  view_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  drive_created_at DATETIME NULL,
  drive_modified_at DATETIME NULL,
  published_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_list (deleted_at, status, visibility, published_at),
  KEY idx_cat (category_id, published_at),
  KEY idx_owner (owner_user_id, published_at),
  KEY idx_views (view_count),
  FULLTEXT KEY ft_search (search_text),
  CONSTRAINT fk_vid_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_vid_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE video_renditions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  video_id BIGINT UNSIGNED NOT NULL,
  height SMALLINT UNSIGNED NOT NULL,
  width SMALLINT UNSIGNED NOT NULL,
  real_height SMALLINT UNSIGNED NOT NULL,
  kind ENUM('quality','compat') NOT NULL DEFAULT 'quality',
  drive_file_id VARCHAR(128) NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  bitrate_kbps INT UNSIGNED NULL,
  status ENUM('pending','ready','failed') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vid_h (video_id, height),
  CONSTRAINT fk_rend_vid FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subtitles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  video_id BIGINT UNSIGNED NOT NULL,
  drive_file_id VARCHAR(128) NOT NULL UNIQUE,
  lang VARCHAR(16) NULL,
  label VARCHAR(64) NOT NULL,
  format ENUM('srt','vtt') NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  drive_modified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_vid (video_id),
  CONSTRAINT fk_sub_vid FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE playlists (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(34) NOT NULL UNIQUE,
  title VARCHAR(150) NOT NULL,
  owner_user_id INT UNSIGNED NULL,
  guest_hash CHAR(64) NULL,
  visibility ENUM('public','private') NOT NULL DEFAULT 'private',
  item_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_owner (owner_user_id, updated_at),
  KEY idx_guest (guest_hash, updated_at),
  KEY idx_vis (visibility, updated_at),
  CONSTRAINT fk_pl_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE playlist_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  playlist_id BIGINT UNSIGNED NOT NULL,
  video_id BIGINT UNSIGNED NOT NULL,
  position INT UNSIGNED NOT NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pl_vid (playlist_id, video_id),
  KEY idx_pos (playlist_id, position),
  CONSTRAINT fk_pli_pl FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  CONSTRAINT fk_pli_vid FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE watch_history (
  user_id INT UNSIGNED NOT NULL,
  video_id BIGINT UNSIGNED NOT NULL,
  position_sec INT UNSIGNED NOT NULL DEFAULT 0,
  duration_sec INT UNSIGNED NOT NULL DEFAULT 0,
  watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, video_id),
  KEY idx_user_time (user_id, watched_at),
  CONSTRAINT fk_wh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_wh_vid FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  lane ENUM('light','heavy') NOT NULL DEFAULT 'light',
  video_id BIGINT UNSIGNED NULL,
  payload JSON NULL,
  priority TINYINT NOT NULL DEFAULT 5,
  status ENUM('queued','running','done','failed','cancelled') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 3,
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  run_after DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pick (status, lane, priority, run_after),
  KEY idx_vid (video_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE uploads (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(22) NOT NULL UNIQUE,
  user_id INT UNSIGNED NOT NULL,
  video_public_id CHAR(11) NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  received_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  visibility ENUM('public','private') NOT NULL,
  category_id INT UNSIGNED NULL,
  target_folder_id VARCHAR(128) NOT NULL,
  session_url_enc TEXT NOT NULL,
  status ENUM('uploading','completed','failed','cancelled','expired') NOT NULL DEFAULT 'uploading',
  drive_file_id VARCHAR(128) NULL,
  video_id BIGINT UNSIGNED NULL,
  error TEXT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user (user_id, status),
  CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settings (
  `key` VARCHAR(100) PRIMARY KEY,
  `value` MEDIUMTEXT NOT NULL,
  is_secret TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NULL,
  target_id VARCHAR(64) NULL,
  meta JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_time (created_at),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
