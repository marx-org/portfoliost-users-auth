INSERT OR IGNORE INTO user_preferences (user_id, language, ui_preferences, custom_benchmarks, custom_timeframes, onboarding_status, onboarding_draft, created_at, updated_at)
VALUES
  ('test-user-001', 'en', '{"chartTimeframe":"1M","tableColumns":["name","value"]}', '[]', '[]', '{"completed":true}', '{"draft":null}', datetime('now'), datetime('now')),
  ('test-user-002', 'de', '{"chartTimeframe":"1Y","tableColumns":["name","value","gain"]}', '[]', '[]', '{"completed":false}', '{"draft":null}', datetime('now'), datetime('now'));
