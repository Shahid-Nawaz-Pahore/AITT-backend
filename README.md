# Soroban Compliance Backend

## Setup

- Copy `.env.example` to `.env` and set values
- Install dependencies: `npm install`
- Start: `npm run dev` (for development)

## Tests

`npm test`

## Notes
- Blockchain integration points are in `src/services/web3.service.js` and are *commented* so you can test flows without a live Soroban contract.
- Follow RBAC by passing a JWT with `role` claim.
