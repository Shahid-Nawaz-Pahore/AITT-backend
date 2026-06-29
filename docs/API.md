# API Endpoints (MVP)

## Auth
- POST /api/v1/auth/register  (admin only - create users)
- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/exchange-key  (keeps API keys in DB, not used by main routes)

## Certificates
- POST /api/v1/certificates          (company_admin)
- GET  /api/v1/certificates/:id      (company_admin | regulator_admin | public-read)
- POST /api/v1/certificates/:id/issue (regulator_admin)
- POST /api/v1/certificates/:id/validate (regulator_admin)
- GET  /api/v1/certificates/:id/verify   (public)


All responses use the envelope: `{ success: boolean, data: object|null, message?: string }`.
