#!/usr/bin/env bash
# Rebuild the Windows app and its installer in one go:
#   bash desktop/build.sh   ->   desktop/out/OddlyCleverPDF-Setup.exe
# Needs Node (for the web build) and the .NET SDK (any version that can build net48 projects).
set -euo pipefail
cd "$(dirname "$0")/.."          # pdf-tool/
D=desktop
B=$D/build
VERSION=$(node -p "require('./package.json').version")
mkdir -p "$B" "$D/out"

echo "== icon"
[ -f "$D/assets/OddlyCleverPDF.ico" ] || node "$D/tools/make_ico.mjs"

echo "== web app $VERSION"
npx vite build --outDir "$B/app" --emptyOutDir > "$B/web-build.log" 2>&1 || { tail -20 "$B/web-build.log"; exit 1; }

echo "== desktop shell and uninstaller"
dotnet publish "$D/app/OddlyCleverPDF.csproj" -c Release -o "$B/bin" -p:Version="$VERSION" -v quiet -nologo
dotnet publish "$D/uninstaller/Uninstaller.csproj" -c Release -o "$B/uninstall" -p:Version="$VERSION" -v quiet -nologo

echo "== staging the program folder"
S=$B/stage
rm -rf "$S"                      # generated each build, like vite's --emptyOutDir
mkdir -p "$S/licenses"
cp "$B/bin/OddlyClever PDF.exe" "$B/bin/OddlyClever PDF.exe.config" \
   "$B/bin/Microsoft.Web.WebView2.Core.dll" "$B/bin/Microsoft.Web.WebView2.WinForms.dll" "$S/"
cp -r "$B/bin/runtimes" "$S/"
cp "$B/uninstall/Uninstall OddlyClever PDF.exe" "$B/uninstall/Uninstall OddlyClever PDF.exe.config" "$S/"
cp -r "$B/app" "$S/app"
cp LICENSE "$S/LICENSE.txt"
cp THIRD_PARTY.md "$S/licenses/THIRD_PARTY.md"
NUGET=$(dotnet nuget locals global-packages -l | sed 's/^global-packages: //' | tr -d '\r')
WV2=$(sed -n 's/.*Include="Microsoft.Web.WebView2" Version="\([^"]*\)".*/\1/p' "$D/app/OddlyCleverPDF.csproj")
cp "$NUGET/microsoft.web.webview2/$WV2/LICENSE.txt" "$S/licenses/WebView2-LICENSE.txt"

echo "== installer"
dotnet publish "$D/installer/Setup.csproj" -c Release -o "$B/setup" -p:Version="$VERSION" -v quiet -nologo
cp "$B/setup/OddlyCleverPDF-Setup.exe" "$D/out/OddlyCleverPDF-Setup.exe"
ls -l "$D/out/OddlyCleverPDF-Setup.exe" | awk '{printf "done: %s (%.1f MB)\n", $NF, $5/1048576}'
