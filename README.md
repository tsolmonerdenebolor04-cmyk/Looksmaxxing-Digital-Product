# GLOWUP AI v0.4 — real Gemini vision analysis prototype

## What works
- Three image inputs: front, side, full body; client-side resizing to 1024px JPEG
- Four-question Mongolian questionnaire, 18+ and explicit photo-processing consent
- Server-side Gemini API call using 3 labeled image parts, JSON schema structured output
- Server-side structural quality checks and one retry; dynamic original roasts checked against reference examples
- Full Mongolian report UI: observations, 3 priorities, roasts, hairstyles, barber card, skincare, wardrobe, photo tips, budget and 4-week plan
- Persistent light/dark preference (only theme stored in localStorage)
- No photo persistence, no database, no payments; full report visible in private test mode

## Setup
1. Create a Google AI Studio API key at https://aistudio.google.com/apikey . Check the account's terms, billing, data handling and region eligibility.
2. For local testing, from project directory: `export GEMINI_API_KEY='...'` (PowerShell: `$env:GEMINI_API_KEY='...'`), then `npm run dev`. Open http://localhost:3000 . Do not put the key in any frontend file or commit it.
3. Deploy this folder to a new Vercel project (framework preset **Other**, root this folder), then configure `GEMINI_API_KEY` as a Vercel server environment variable. Optionally set `GEMINI_MODEL`.
4. Run `npm test` for unit tests. Test actual AI output with consented adult photos and confirm observations match reality.

## Important limitations before public launch
- **Not deployed or live-tested against Gemini without a key.** Real output quality and model compatibility require live testing.
- This is a **private test-only** prototype. There is no payment gate, durable session storage, account access control, or persistent report storage.
- The in-memory IP rate limit is not reliable across serverless instances. Before public exposure, implement shared Redis/Upstash rate limiting, bot protection, per-user quotas and spend caps. Prevent free analysis abuse.
- Photos are not stored by this application, but are transmitted to Google Gemini for processing. Review Google's data retention/training terms for your chosen plan, publish a privacy notice, and establish consent and deletion policy before launch.
- API request size, 60-second function timeout and model output length can affect large/slow reports. Consider async jobs if latency exceeds limits.
- Quality checks verify schema, budgets, joke repetition and minimum sections, **not whether model observations are visually correct**. Human evaluation and optionally a separate evidence-checking pass are required before charging.
- The 62/100-style scores are subjective presentation heuristics, not objective attractiveness, medical or biometric measurements.
- Avoid logging image payloads or sensitive customer details in production. Store full paid reports privately and verify payment on server before returning them.
- Google AI API key must stay server-side. Vercel project needs billing/limits review before public use.
