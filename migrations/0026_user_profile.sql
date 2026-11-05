ALTER TABLE users
  ADD COLUMN display_name VARCHAR(120) NULL AFTER email,
  ADD COLUMN phone VARCHAR(32) NULL AFTER display_name;
