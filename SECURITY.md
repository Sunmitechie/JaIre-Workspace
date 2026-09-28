# Security Policy

This document describes how security vulnerabilities are identified, triaged, fixed, and communicated across the JaIre monorepo.

## Scope

This policy applies to:
- the root repository and all workspace packages,
- application configuration and environment variables,
- infrastructure definitions such as Docker and Compose files,
- Python, TypeScript, and backend service code,
- deployment and CI/CD automation files.

## Core Security Principles

- No secrets or private credentials are committed to source control.
- Environment variables must be supplied via local `.env` files or deployment secrets managers.
- All API keys, OAuth credentials, wallet keys, and payment credentials must be kept out of Git history.
- Code must fail closed: if a required secret is missing, the service should stop with a clear error instead of silently using a default fallback secret.
- Dependencies, build tools, and runtime services are reviewed for known vulnerabilities.

## Secrets Handling

### Required Rules
- Never commit `.env`, `.env.*`, or generated secret files.
- Use a safe template like `.env.example` or `.env.template` for non-sensitive placeholders only.
- Do not hardcode production, staging, or test credentials in source code.
- Do not include secrets in logs, trace output, screenshots, or error messages.
- Remove any secret from Git history if it was ever committed.

### Repository Guardrails
- The repository ignores environment files via `.gitignore` rules such as:
  - `.env`
  - `.env.*`
  - `!.env.example`
- GitHub push protections and secret scanning should be enabled for the remote repository.
- Any secret leak should be treated as a security incident and remediated immediately.

## Dependency and Supply Chain Security

The project uses automated checks to reduce the risk of vulnerable dependencies:
- Node dependency auditing via `pnpm audit` or equivalent security scanning.
- Python package review via `pip`/`uv` dependency review and vulnerability tooling.
- CI pipeline checks to run install and security validation automatically.
- Regular updates of core runtime and build dependencies.

## Code Review and Vulnerability Handling

### Reporting a Vulnerability
If you discover a security issue, report it privately to the repository maintainers or designated security contact before disclosing it publicly.

Include:
- affected component or file,
- reproduction steps,
- impact assessment,
- suggested remediation or mitigation.

### Triage Process
1. Validate the issue and determine severity.
2. Identify affected branches, versions, and deployments.
3. Assess whether the issue exposes secrets, payment data, wallet data, user accounts, or infrastructure access.
4. Prioritize a patch and communication plan.
5. Apply the fix and validate it in a protected test environment.
6. Document the root cause and preventive change.

### Fix Standards
- Fixes must not introduce new secret leakage.
- Sensitive values must never be stored in plaintext in source files or test fixtures.
- Security fixes should include or update tests when applicable.
- Any secret that is found in Git history must be removed and the history rewritten or sanitized according to the repository’s recovery plan.

## Threat Model

JaIre handles financial rails, wallet keys, user identity, and payment webhooks. The primary threats are:
- secret exfiltration from `.env` files, shell history, CI logs, or crash traces,
- webhook spoofing against Paystack or other external providers,
- wallet-signing or treasury-key compromise,
- unauthorized admin access via poorly protected routes,
- dependency and supply-chain compromise from unreviewed packages.

The project’s security controls assume that an attacker may have access to source code, public build artifacts, or intercepted network traffic, but not to a managed secret store or a protected environment variable layer. All high-risk secrets must therefore be provisioned at runtime and never live in repo files or generated build artifacts.

## Secret Manager Guidance

For production and staging environments, use a dedicated secret manager such as AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, Doppler, or HashiCorp Vault. The application should resolve values from the environment or an approved secret provider at startup, not from source-controlled files.

Recommended rules:
- Store `JWT_SECRET`, `PAYSTACK_SECRET_KEY`, `JAIRE_TREASURY_PRIVATE_KEY`, and `WEB3AUTH_NODE_FACTOR_KEY` in the platform secret manager.
- Keep local development values in `.env.local` or a per-user `.env` that is gitignored and never committed.
- Restrict access to secrets by environment, service, and deployment role.
- Rotate secrets on a regular cadence and immediately after any suspected exposure.
- Treat private keys as critical assets: they must be logged only as redacted metadata and never as raw values.

## Payment and Authentication Security

The application handles financial and authentication flows, so the following controls are mandatory:
- payment credentials must come from environment variables or secret stores,
- JWT signing secrets must never be hardcoded,
- webhook signing keys must be validated before processing requests,
- external API calls must validate response integrity and reject invalid signatures,
- production secrets must not be used in local or test environments.

## CI/CD and Deployment Security

- CI workflows should lint, test, and validate builds before merge.
- Deployment environments must inject secrets through secure providers rather than repository files.
- Docker and Compose configurations should avoid embedding secrets in images or defaults.
- Publicly exposed services must be protected by least-privilege access controls.

## Incident Response

If a vulnerability is discovered or a secret leak is identified:
1. Stop the bleed and revoke the affected credentials immediately.
2. Remove the secret from the repository and all relevant branches.
3. Rewrite Git history if it was committed before the detection.
4. Rotate any exposed key or token.
5. Audit logs, integrations, and downstream systems for abuse.
6. Communicate the issue and remediation status to maintainers and affected stakeholders.

## Compliance and Review

This security policy should be reviewed at least quarterly and whenever the architecture changes significantly. Security practices evolve with new dependencies, services, and infrastructure, and the codebase is expected to remain aligned with the principles above.

## Summary

JaIre treats security as a first-class engineering discipline. The project avoids default secrets, treats leaked credentials as incidents, enforces environment-based configuration, and requires explicit security validation for every critical component.
