using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace OddlyClever
{
    /// <summary>Removes the program folder, shortcuts and registry entries. Settings and the browser profile in
    /// %LOCALAPPDATA%\OddlyCleverPDF are left alone, so a reinstall picks up where you left off.
    /// /S runs quietly.</summary>
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            bool quiet = args.Any(a => string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase));
            Application.EnableVisualStyles();
            if (!quiet && MessageBox.Show($"Remove {Product.Name} from this PC?", "Uninstall " + Product.Name,
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
                return 1;

            while (Integration.AppIsRunning())
            {
                if (quiet) return 2;
                if (MessageBox.Show($"{Product.Name} is open. Please close it, then click Retry.", "Uninstall " + Product.Name,
                        MessageBoxButtons.RetryCancel, MessageBoxIcon.Information) != DialogResult.Retry)
                    return 1;
            }

            try
            {
                Integration.RemoveShortcuts();
                Integration.Unregister();
                RemoveProgramFolder();
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
            {
                if (!quiet) MessageBox.Show("Some files couldn't be removed:\n\n" + e.Message, "Uninstall " + Product.Name,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 3;
            }
            if (!quiet) MessageBox.Show($"{Product.Name} has been removed. Thanks for trying it!", "Uninstall " + Product.Name);
            RemoveSelfAfterExit();
            return 0;
        }

        static string Self => Path.GetFullPath(Application.ExecutablePath);

        /// <summary>Everything in the folder goes now except this running exe (see RemoveSelfAfterExit).</summary>
        static void RemoveProgramFolder()
        {
            string dir = Product.InstallDir;
            if (!Directory.Exists(dir)) return;
            foreach (var sub in Directory.GetDirectories(dir)) Directory.Delete(sub, true);
            foreach (var file in Directory.GetFiles(dir))
                if (!string.Equals(Path.GetFullPath(file), Self, StringComparison.OrdinalIgnoreCase)) File.Delete(file);
        }

        /// <summary>A hidden cmd keeps trying (for up to ~30 s) to delete this exe once it has exited, then the
        /// empty program folder. Started last, so nothing still holds the file open for long.</summary>
        static void RemoveSelfAfterExit()
        {
            string dir = Product.InstallDir;
            if (!File.Exists(Self) || !string.Equals(Path.GetDirectoryName(Self), dir, StringComparison.OrdinalIgnoreCase)) return;
            Process.Start(new ProcessStartInfo("cmd.exe",
                $"/c for /l %i in (1,1,30) do (ping -n 2 127.0.0.1 >nul & del /f /q \"{Self}\" 2>nul & if not exist \"{Self}\" (rmdir \"{dir}\" 2>nul & exit))")
            {
                CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = Path.GetTempPath(),
            });
        }
    }
}
