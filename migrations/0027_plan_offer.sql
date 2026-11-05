-- Saved free-trial length and the public plan-card copy.
-- New signups read trial_days from this row. Existing organizations.trial_ends_at
-- values are not read or written here.
-- {days} in a headline is replaced with the saved trial length when the
-- public plans response is built.

CREATE TABLE IF NOT EXISTS plan_offer (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  trial_days INT NOT NULL,
  trial_limitations VARCHAR(500) NOT NULL,
  free_headline VARCHAR(160) NOT NULL,
  free_bullets TEXT NOT NULL,
  full_headline VARCHAR(160) NOT NULL,
  full_bullets TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO plan_offer (
  id, trial_days, trial_limitations, free_headline, free_bullets, full_headline, full_bullets
) VALUES (
  1,
  8,
  'Every feature is included until the trial ends. After that the clinic is read-only until a platform administrator activates it. No other limits apply during the trial.',
  '{days}-day free trial with every feature',
  '["Every current feature is included","No card required to start","The clinic is read-only after the trial ends"]',
  'Full access to every feature, billed monthly',
  '["The same features as the trial, while the subscription is paid","The monthly price is the saved regional price"]'
);
