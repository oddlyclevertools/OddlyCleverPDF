#!/usr/bin/env bash
# Build the app and publish dist/ to the gh-pages branch (GitHub Pages serves it).
# Run from the repo root after committing: bash tools/publish_pages.sh
set -euo pipefail
npm test
npm run build
touch dist/.nojekyll
rev=$(git rev-parse --short HEAD)
origin=$(git remote get-url origin)
tmp=$(mktemp -d)
cp -r dist/. "$tmp"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Publish ${rev}" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -f "$origin" gh-pages
echo "Published ${rev} to gh-pages"
