# Download page

`website/` is a static page for GitHub Pages. It does not build the desktop app and it does not store installers. In the browser it calls `GET /repos/aaronilyas/BridgeToGrowth-Learning/releases/latest` and turns a download button on only when that stable release has the matching file. A new `v*` release updates the buttons on the next visit. This workflow does not have to run again.

`/releases/latest` is the newest release that is not a draft and not a pre-release. A 404 means nothing stable is published, and every button stays off. A network failure, rate limit, or payload this page cannot verify does the same, and the page keeps a link to the [releases list](https://github.com/aaronilyas/BridgeToGrowth-Learning/releases).

## Files

| Computer | File |
|---|---|
| Windows 10 or 11 (64-bit) | `BridgeToGrowthLearning-Setup-x64.exe` |
| macOS (Apple silicon, arm64) | `BridgeToGrowthLearning-macOS-arm64.dmg` |
| Ubuntu, Debian, Linux Mint (64-bit) | `BridgeToGrowthLearning-amd64.deb` |
| Other Linux (64-bit) | `BridgeToGrowthLearning-x86_64.AppImage` |

Those are the names [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) uploads. Intel Mac and ARM Linux installers are not built there, and this page does not offer them. The installers are not code-signed or notarized yet. The page says so.

## Publish

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) checks the page on pull requests and, on `main`, uploads `website/` to GitHub Pages. This repository does not have a Pages site yet. Merging the workflow does not change repository settings. An admin still has to:

1. Open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. Skip GitHub's suggested starter workflow. `pages.yml` is already in the repository.
2. Let the **pages** workflow run on `main`, or run it with **workflow_dispatch** after the file is on `main`.
3. Under **Settings → Pages → Custom domain**, enter `bridgetogrowth-learning.com` and save. Do this before changing DNS.
4. After DNS answers with GitHub's addresses, turn on **Enforce HTTPS**. GitHub can take up to 24 hours to offer that checkbox.

`website/CNAME` records the domain we intend to use. GitHub's current documentation says a `CNAME` file is ignored when the publishing source is a GitHub Actions workflow, so step 3 is required. This change does not call the Pages API.

The deploy job asks `GITHUB_TOKEN` for `pages: write` and `id-token: write`. If Actions is turned off for the repository, or a policy denies those permissions, the deploy job fails until an admin allows it. The token used while preparing this change could not read the repository's Actions permission setting.

Pull requests do not deploy. Only a push to `main` (or a manual run on `main`) does.

The project URL after the first successful deploy is `https://aaronilyas.github.io/BridgeToGrowth-Learning/`. Saving the custom domain makes that URL redirect to the domain, so save it when DNS is about to change. Until then, leave the domain on its current records.

Also verify `bridgetogrowth-learning.com` on the GitHub account (**Settings → Pages**, on the account, not only this repository) and add the TXT record GitHub displays. Verification stops another repository from claiming the domain. The TXT value is shown in that screen. It is not stored in this repo.

## DNS

Do this after the custom domain is saved on the Pages site. This change does not edit DNS.

Today the apex is a proxied CNAME to a Cloudflare tunnel, and `www` is a proxied CNAME to the apex. Both stay as they are until you switch them. While they still point at the tunnel, `bridgetogrowth-learning.com` will not show this page.

GitHub's host for this account is `aaronilyas.github.io`. Point records at that host. Do not use `*.pages.github.io`, and do not append the repository name.

Apex `bridgetogrowth-learning.com`, either all eight address records:

| Type | Name | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |

or one flattened CNAME (ALIAS) at the apex:

| Type | Name | Value |
|---|---|---|
| CNAME | `@` | `aaronilyas.github.io` |

`www` needs its own record, aimed at GitHub rather than at the apex:

| Type | Name | Value |
|---|---|---|
| CNAME | `www` | `aaronilyas.github.io` |

GitHub warns that a `www` record which only aliases the apex breaks the HTTPS redirect. Leave these records DNS-only (grey cloud). A proxied record hides GitHub's addresses, and the Pages certificate check then often fails. Remove the tunnel target from the apex when you cut over. Do not add a wildcard such as `*.bridgetogrowth-learning.com`.

Check:

```sh
dig bridgetogrowth-learning.com +noall +answer -t A
dig bridgetogrowth-learning.com +noall +answer -t AAAA
dig www.bridgetogrowth-learning.com +nostats +nocomments +nocmd
```

The `A` and `AAAA` answers should be the addresses above, or `www` should show a CNAME to `aaronilyas.github.io`.

## Local check

```sh
bun test scripts/download-page.test.js
bun scripts/check-download-page.ts
```

`?preview=empty`, `?preview=error`, `?preview=release`, and `?preview=partial` work only on `localhost`, `127.0.0.1`, and `::1`. On the public host they are ignored, so a query string cannot turn on a fake download.
