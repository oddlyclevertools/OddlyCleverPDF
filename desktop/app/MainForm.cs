using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace OddlyClever
{
    /// <summary>The app window: WebView2 showing the web build from a private https address, so it gets a
    /// secure context (service worker, workers, wasm, clipboard) without a local server.</summary>
    sealed class MainForm : Form
    {
        const string Host = "app.oddlycleverpdf.local";
        static readonly Color Paper = Color.FromArgb(0xff, 0xf4, 0xe3);

        // Files passed on the command line arrive as shared buffers and are dropped onto the page, which
        // opens them through the app's own drag-and-drop path.
        const string OpenFilesScript = @"
if (window === window.top) (() => {
  const queue = [];
  let loaded = document.readyState === 'complete';
  const flush = () => {
    if (!loaded || !queue.length) return;
    const dt = new DataTransfer();
    for (const f of queue.splice(0)) dt.items.add(f);
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  };
  addEventListener('load', () => { loaded = true; setTimeout(flush, 0); });
  window.chrome.webview.addEventListener('sharedbufferreceived', (e) => {
    const meta = e.additionalData || {};
    if (meta.kind !== 'open-file') return;
    const buf = e.getBuffer();
    const bytes = new Uint8Array(buf).slice();
    window.chrome.webview.releaseBuffer(buf);
    queue.push(new File([bytes], meta.name, { type: meta.type }));
    if (meta.last) setTimeout(flush, 0);
  });
})();";

        readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };
        readonly List<string> pendingFiles;
        CoreWebView2Environment env;

        public MainForm(List<string> files)
        {
            pendingFiles = files;
            Text = Product.Name;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            BackColor = Paper;
            MinimumSize = new Size(480, 400);
            web.DefaultBackgroundColor = Paper;
            Controls.Add(web);
            WindowPlacement.Restore(this);
            Load += async (s, e) => await StartAsync();
            FormClosing += (s, e) => WindowPlacement.Save(this);
        }

        static string AppFolder()
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string installed = Path.Combine(exeDir, "app");
            string dev = Path.GetFullPath(Path.Combine(exeDir, "..", "app")); // desktop/build/bin -> desktop/build/app
            return File.Exists(Path.Combine(installed, "index.html")) ? installed : dev;
        }

        async Task StartAsync()
        {
            string appDir = AppFolder();
            if (!File.Exists(Path.Combine(appDir, "index.html")))
            {
                MessageBox.Show(this, "I couldn't find the app's files next to this program. Reinstalling OddlyClever PDF should fix it.",
                    Product.Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }
            try
            {
                env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Product.DataDir, "WebView2"));
                await web.EnsureCoreWebView2Async(env);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                var answer = MessageBox.Show(this,
                    "OddlyClever PDF needs the Microsoft Edge WebView2 Runtime, which is part of Windows 11 but missing here.\n\n" +
                    "Open the download page now? It's free and takes a minute.",
                    Product.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (answer == DialogResult.Yes) OpenInBrowser("https://developer.microsoft.com/microsoft-edge/webview2/");
                Close();
                return;
            }

            var core = web.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping(Host, appDir, CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("OCPDF_DEVTOOLS") == "1";
            core.NewWindowRequested += (s, e) => { if (IsExternal(e.Uri)) { e.Handled = true; OpenInBrowser(e.Uri); } };
            core.NavigationStarting += (s, e) => { if (IsExternal(e.Uri)) { e.Cancel = true; OpenInBrowser(e.Uri); } };
            core.NavigationCompleted += (s, e) => { if (e.IsSuccess) SendPendingFiles(); };
            await core.AddScriptToExecuteOnDocumentCreatedAsync(OpenFilesScript);
            core.Navigate($"https://{Host}/index.html");
        }

        /// <summary>Web links leave the app and open in the default browser; the app's own pages stay.</summary>
        static bool IsExternal(string uri)
        {
            if (!Uri.TryCreate(uri, UriKind.Absolute, out var u)) return false;
            if (u.Scheme == Uri.UriSchemeMailto) return true;
            return (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps)
                && !string.Equals(u.Host, Host, StringComparison.OrdinalIgnoreCase);
        }

        static void OpenInBrowser(string uri)
        {
            try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
            catch (Exception e) when (e is System.ComponentModel.Win32Exception || e is InvalidOperationException)
            {
                MessageBox.Show("I couldn't open your browser for this link:\n" + uri, Product.Name);
            }
        }

        void SendPendingFiles()
        {
            var files = new List<string>(pendingFiles);
            pendingFiles.Clear();
            for (int i = 0; i < files.Count; i++)
            {
                byte[] bytes;
                try { bytes = File.ReadAllBytes(files[i]); }
                catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
                {
                    MessageBox.Show(this, $"I couldn't read {Path.GetFileName(files[i])}:\n{e.Message}", Product.Name);
                    continue;
                }
                string meta = "{\"kind\":\"open-file\",\"name\":" + JsonString(Path.GetFileName(files[i])) +
                    ",\"type\":" + JsonString(MimeType(files[i])) + ",\"last\":" + (i == files.Count - 1 ? "true" : "false") + "}";
                using (var buffer = env.CreateSharedBuffer((ulong)Math.Max(1, bytes.Length)))
                {
                    using (var stream = buffer.OpenStream()) stream.Write(bytes, 0, bytes.Length);
                    web.CoreWebView2.PostSharedBufferToScript(buffer, CoreWebView2SharedBufferAccess.ReadOnly, meta);
                }
            }
        }

        static string MimeType(string path)
        {
            switch (Path.GetExtension(path).ToLowerInvariant())
            {
                case ".pdf": return "application/pdf";
                case ".png": return "image/png";
                case ".jpg": case ".jpeg": return "image/jpeg";
                case ".webp": return "image/webp";
                case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                default: return "";
            }
        }

        static string JsonString(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c);
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }
    }
}
