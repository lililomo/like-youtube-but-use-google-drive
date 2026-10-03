-- Impor YouTube untuk semua pengguna (dianggap upload): video masuk ke channel pemilik impor.
-- owner_user_id NULL = channel utama (impor dari Studio admin, termasuk semua baris lama).
ALTER TABLE youtube_imports
  ADD COLUMN owner_user_id INT UNSIGNED NULL AFTER category_id,
  ADD KEY idx_owner (owner_user_id, id);
