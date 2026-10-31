using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;

namespace OddlyClever
{
    /// <summary>Unpacks the embedded program files to %LOCALAPPDATA%\Programs\OddlyCleverPDF and hooks them
    /// into Windows (shortcuts, "Apps &amp; features", "Open with").</summary>
    static class Installer
    {
        public static string Version
        {
            get
            {
                var v = Assembly.GetExecutingAssembly().GetName().Version;
                return $"{v.Major}.{v.Minor}.{v.Build}";
            }
        }

        public static void Run(bool desktopShortcut, Action<int> progress)
        {
            if (Integration.AppIsRunning()) throw new AppRunningException();
            string dir = Product.InstallDir;
            // an update replaces the whole folder, so old web files with stale names don't pile up
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
            Directory.CreateDirectory(dir);

            long total = 0;
            using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (var zip = new ZipArchive(payload ?? throw new InvalidOperationException("This installer is missing its program files."), ZipArchiveMode.Read))
            {
                int done = 0;
                foreach (var entry in zip.Entries)
                {
                    string target = Path.GetFullPath(Path.Combine(dir, entry.FullName));
                    if (!target.StartsWith(dir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Unexpected path in the installer: " + entry.FullName);
                    if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\")) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, true);
                    total += entry.Length;
                    progress(++done * 90 / zip.Entries.Count);
                }
            }

            Integration.AddShortcuts(desktopShortcut);
            progress(95);
            Integration.Register(Version, total);
            progress(100);
        }

        public static void Launch() =>
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Path.Combine(Product.InstallDir, Product.ExeName))
            { UseShellExecute = true, WorkingDirectory = Product.InstallDir });
    }

    sealed class AppRunningException : Exception
    {
        public AppRunningException() : base("OddlyClever PDF is open. Please close it, then try again.") { }
    }
}
