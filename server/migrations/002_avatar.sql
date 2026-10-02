-- Foto profil user (file di storage/public/avatars/<id>-<key>.webp; NULL = avatar huruf + warna).
ALTER TABLE users ADD COLUMN avatar_key VARCHAR(16) NULL AFTER avatar_color;
