-- Spotreba tokenov Gemini na hárok (na výpočet nákladov)
alter table answer_submissions add column if not exists ai_usage jsonb;
