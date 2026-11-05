ALTER TABLE users
  ADD COLUMN theme ENUM('light', 'dark', 'system') NOT NULL DEFAULT 'system' AFTER phone;
