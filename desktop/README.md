# OddlyClever PDF for Windows

This folder turns the web app into a normal Windows program: `OddlyClever PDF.exe`, plus a small installer, `OddlyCleverPDF-Setup.exe`.

It's the same app as the website. It runs in a window of its own, with its own icon in the Start menu and on the taskbar, and it opens PDFs from Explorer. It's free and there's no account. Your files never leave your PC.

## Installing it

1. Download `OddlyCleverPDF-Setup.exe` from the [latest release](https://github.com/oddlyclevertools/OddlyCleverPDF/releases/latest).
2. Run it and click **Install**. It installs just for you, in `%LOCALAPPDATA%\Programs\OddlyCleverPDF`, so it doesn't ask for admin rights.
3. Open it from the Start menu or the desktop shortcut. You can also right-click a PDF and choose **Open with → OddlyClever PDF**. It never makes itself your default PDF app, so that choice stays yours.

### "Windows protected your PC"

The first time you run the installer, Windows may show a blue box saying **"Windows protected your PC"**. That happens because I don't pay for a code-signing certificate, so Windows doesn't recognise the file yet. It isn't a sign that something is wrong.

To carry on, click **More info**, then **Run anyway**.

If you'd rather check the file first, the whole source is in this repository, and you can build the installer yourself (see below).

### Uninstalling

Go to **Settings → Apps → Installed apps**, find **OddlyClever PDF** and click **Uninstall**. This removes the program, its shortcuts and its "Open with" entry. Your settings and anything you were working on stay in `%LOCALAPPDATA%\OddlyCleverPDF`, so a reinstall picks up where you left off. If you want a completely clean slate, delete that folder too.

## What it needs

- Windows 10 or 11.
- The Microsoft Edge WebView2 Runtime, which comes with Windows 11 and recent Windows 10. If it's missing, the app tells you and offers the free download page.
- .NET Framework 4.8, which is part of Windows, so there's nothing extra to install.

## Building it yourself

You'll need [Node.js](https://nodejs.org) and the [.NET SDK](https://dotnet.microsoft.com/download) (version 8 or later). From the `pdf-tool` folder:

```bash
npm install
bash desktop/build.sh
```

That builds the web app into `desktop/build/app`, then compiles the window and the uninstaller and packs everything into `desktop/out/OddlyCleverPDF-Setup.exe`. The version number comes from `package.json`.

To try the app without installing it, run `desktop/build/bin/OddlyClever PDF.exe`. It finds the web files in `desktop/build/app`.

The installer can also run quietly: `OddlyCleverPDF-Setup.exe /S` (add `/nodesktop` to skip the desktop shortcut). The uninstaller takes `/S` too. If you run these from Git Bash, write `//S`, because Git Bash turns `/S` into a path.

### How it fits together

| Folder | What it is |
| --- | --- |
| `app/` | The window: WinForms and WebView2. It serves the web build from a private `https://app.oddlycleverpdf.local/` address, so workers, wasm and the clipboard work just as they do on the website. It remembers its size and position, sends web links to your browser, and saves downloads to your Downloads folder. |
| `installer/` | `OddlyCleverPDF-Setup.exe`, with the program zipped inside. |
| `uninstaller/` | `Uninstall OddlyClever PDF.exe`, which "Apps & features" runs. |
| `shared/` | Names, folders and the Windows hooks: shortcuts, registry entries and "Open with". |
| `assets/` | The app icon, made from `public/favicon.svg` by `tools/make_ico.mjs`. |
| `tools/smoke_desktop.mjs` | A quick check: it starts the exe with a PDF, makes sure the PDF opens, and checks that "Save PDF" writes a file. |

Inside the app, `window.chrome.webview` exists. That's how the web page knows it's running as the desktop app.

## Licences

The app is MIT licensed, like the rest of OddlyClever PDF. The Microsoft WebView2 SDK files it ships with are BSD-3-Clause. Their licence is installed next to the app, in `licenses/`.
