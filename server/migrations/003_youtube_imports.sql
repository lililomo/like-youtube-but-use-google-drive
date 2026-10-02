-- Impor video dari YouTube (Studio → Impor YouTube): unduh ≤1080p dengan yt-dlp → upload ke folder Drive → pipeline biasa.
-- Status akhir diturunkan dari job (jobs.status); `phase` = tahap saat job berjalan.
CREATE TABLE youtube_imports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  url VARCHAR(500) NOT NULL,
  yt_id VARCHAR(16) NOT NULL,
  title VARCHAR(500) NULL,
  channel VARCHAR(200) NULL,
  duration_sec INT UNSIGNED NULL,
  phase ENUM('queued','downloading','uploading','done') NOT NULL DEFAULT 'queued',
  format_note VARCHAR(100) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  visibility ENUM('public','private') NOT NULL DEFAULT 'public',
  category_id INT UNSIGNED NULL,
  job_id BIGINT UNSIGNED NULL,
  video_id BIGINT UNSIGNED NULL,
  drive_file_id VARCHAR(128) NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  KEY idx_yt (yt_id),
  KEY idx_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lane khusus unduhan (jaringan) agar tidak menghalangi konversi ffmpeg (lane heavy).
ALTER TABLE jobs MODIFY lane ENUM('light','heavy','download') NOT NULL DEFAULT 'light';
