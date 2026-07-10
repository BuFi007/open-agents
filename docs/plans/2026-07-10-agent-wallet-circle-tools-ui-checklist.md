# BUFI Agent Wallet: Circle Tool Contract + UI Checklist

This is the integration contract for the BUFI agentic wallet face. The backend must expose the Circle-compatible tool surface from `@open-agents/agent-wallet`; the UI can then render a branded Stripe-developer-style dev tool with Eve traces, workflow state, and explicit approval boundaries.

Primary upstream references:

- Circle Vercel AI kit tool surface: `circlefin/agent-stack-starter-kits/kits/vercel-ai/src/tools.ts`
- Circle Mastra onboarding sequence: setup skill → session → wallet → balance → funding guidance → service discovery → payment

## Tool surface

The UI must treat these tools as first-class workflow nodes, not hidden helper calls.

### Setup and session

- `fetch_setup_skill`
- `fetch_sub_skill`
- `circle_login`
- `circle_logout`

### Wallet

- `circle_list_wallets`
- `circle_create_wallet`
- `circle_get_balance`
- `circle_deploy_wallet`
- `circle_wallet_fund`
- `circle_fund_fiat`

### Service discovery

- `circle_search_services`
- `circle_inspect_service`
- `fetch_service`
- `call_free_service`

### Gateway and payment

- `circle_get_gateway_balance`
- `circle_pay_service`
- `circle_gateway_deposit`

## Required workflow sequence

1. Read Circle setup instructions with `fetch_setup_skill`.
2. Confirm or establish the Circle session with `circle_login`; allow `circle_logout` for account switching.
3. Call `circle_list_wallets`; if missing, pause for approval, then call `circle_create_wallet` and `circle_deploy_wallet`.
4. Read wallet and Gateway balances with `circle_get_balance` and `circle_get_gateway_balance`.
5. If USDC is zero, call `fetch_sub_skill` with funding guidance and offer explicit funding actions through `circle_wallet_fund` or `circle_fund_fiat`.
6. Discover services with `fetch_sub_skill`, `circle_search_services`, `fetch_service` or `call_free_service`, then `circle_inspect_service` for paid endpoints.
7. Before any spend, show an approval panel. Only after approval call `circle_pay_service`; if Gateway balance is required, approve and call `circle_gateway_deposit`, then retry payment.

## BUFI-branded UI checklist

- Wallet face states: not connected, session valid, session expired, wallet missing, wallet created, wallet deployed, funded, Gateway funded.
- Tool registry panel: all tools grouped by setup, wallet, service, and payment, each with latest status, risk, trace ID, and result summary.
- Workflow timeline: setup → session → wallet → balance → funding guidance → service discovery → payment.
- Approval modal for every mutation/spend: show tool name, destination URL, wallet address, chain, amount, token, Gateway method, service schema, estimated fee when available, and sanitized trace context.
- Eve trace drawer: sanitized tool args/results, workflow run ID, step ID, retry/cancellation state, and evidence hash. Never show API keys, OTPs, session secrets, raw private data, or credential material.
- Policy gates: backend-enforced approval requirement for wallet creation, deploy, funding, fiat on-ramp, x402 pay, and Gateway deposit. The UI is presentation only; it must not be the sole enforcement layer.
- Dogfood report: read-only run proves session status, wallet list, balances, service search, inspect behavior, and denied-spend behavior before any live spend path is enabled.

## Hard boundaries

- Do not accept Circle terms on behalf of the user.
- Do not store OTPs, PINs, API keys, recovery material, or session secrets in traces.
- Do not auto-pay, auto-deposit, auto-deploy, auto-fund, or auto-create wallets without an approval event.
- Do not let a UI-only checkbox bypass backend approval checks.
- Do not mix tax/passport/factoring claims into wallet traces unless the user has granted the relevant consent scope.
