using System;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace OddlyClever
{
    static class Program
    {
        /// <summary>Start the window. Any file paths on the command line ("Open with", or a PDF dropped
        /// on the exe) are opened in the app once it has loaded.</summary>
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var files = args.Where(File.Exists).Select(Path.GetFullPath).ToList();
            Application.Run(new MainForm(files));
        }
    }
}
