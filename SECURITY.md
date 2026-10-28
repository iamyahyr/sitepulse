# Security policy

SitePulse makes HTTP requests to URLs that users type in, so server-side request forgery (SSRF) and anything that could reach internal networks, cloud metadata endpoints or other users' data are taken especially seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub: on this repository, go to **Security → Report a vulnerability**.

Include what you can of:

- the affected version or commit,
- steps to reproduce (a URL, a DNS setup, a redirect chain…),
- what an attacker gains.

You can expect an acknowledgement within a few days. Fixes are released as a new version, and reporters are credited unless they prefer otherwise.

## Supported versions

Only the latest release receives security fixes.

## Scope

In scope: the web app, the worker, the published Docker images and the demo mode (`DEMO_MODE`), including bypasses of the SSRF guard (address validation, DNS pinning, redirect handling), of the read-only demo, or of per-user data isolation.

Out of scope: denial of service by an authenticated admin of their own instance, and findings that require a misconfiguration explicitly documented as unsafe (for example allowing broad ranges with `ALLOW_PRIVATE_CIDRS`).
