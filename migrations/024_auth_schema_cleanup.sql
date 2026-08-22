-- Removes the unused Google profile image retained by the local authentication schema.

ALTER TABLE auth_users
  DROP COLUMN image_url;
