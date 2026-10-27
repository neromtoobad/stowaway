#!/bin/sh
# Builds the web app and publishes it to Vercel project "stowaway" at stowaway.nerom.site.
set -eu
cd "$(dirname "$0")/.."
(cd contracts && forge test -q)
(cd web && npm run build)
mkdir -p deploy/site
rsync -a --delete --exclude .vercel web/dist/ deploy/site/
cd deploy/site
[ -f .vercel/project.json ] || npx -y vercel@latest link --yes --project stowaway
npx -y vercel@latest deploy --prod --yes
npx -y vercel@latest domains add stowaway.nerom.site stowaway 2>/dev/null || true
