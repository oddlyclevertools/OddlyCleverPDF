using System;
using System.Linq;
using System.Windows.Forms;

namespace OddlyClever
{
    static class Program
    {
        /// <summary>OddlyCleverPDF-Setup.exe [/S] [/nodesktop]. /S installs quietly (exit code 0 = installed).</summary>
        [STAThread]
        static int Main(string[] args)
        {
            bool Has(string flag) => args.Any(a => string.Equals(a, flag, StringComparison.OrdinalIgnoreCase));
            if (Has("/S"))
            {
                try { Installer.Run(!Has("/nodesktop"), _ => { }); return 0; }
                catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
            return 0;
        }
    }
}
