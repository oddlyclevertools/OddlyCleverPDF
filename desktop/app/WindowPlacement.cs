using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace OddlyClever
{
    /// <summary>Remembers the window's size, position and maximised state between runs.</summary>
    static class WindowPlacement
    {
        static string FilePath => Path.Combine(Product.DataDir, "window.txt");

        public static void Restore(Form form)
        {
            form.StartPosition = FormStartPosition.Manual;
            var area = Screen.PrimaryScreen.WorkingArea;
            var fallback = new Rectangle(0, 0, Math.Min(1320, area.Width - 40), Math.Min(860, area.Height - 40));
            fallback.Offset(area.Left + (area.Width - fallback.Width) / 2, area.Top + (area.Height - fallback.Height) / 2);
            form.Bounds = fallback;
            try
            {
                if (!File.Exists(FilePath)) return;
                var p = File.ReadAllText(FilePath).Trim().Split(',')
                    .Select(s => int.Parse(s, CultureInfo.InvariantCulture)).ToArray();
                var saved = new Rectangle(p[0], p[1], p[2], p[3]);
                // only use it if a good part of the window is still on a connected screen
                bool visible = Screen.AllScreens.Any(s =>
                {
                    var hit = Rectangle.Intersect(s.WorkingArea, saved);
                    return hit.Width >= 200 && hit.Height >= 120;
                });
                if (visible && saved.Width >= form.MinimumSize.Width && saved.Height >= form.MinimumSize.Height)
                    form.Bounds = saved;
                if (p.Length > 4 && p[4] == 1) form.WindowState = FormWindowState.Maximized;
            }
            catch (Exception e) when (e is IOException || e is FormatException || e is IndexOutOfRangeException || e is UnauthorizedAccessException)
            {
                // a damaged or unreadable file just means the default placement
            }
        }

        public static void Save(Form form)
        {
            var r = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
            int max = form.WindowState == FormWindowState.Maximized ? 1 : 0;
            try
            {
                Directory.CreateDirectory(Product.DataDir);
                File.WriteAllText(FilePath, string.Join(",", r.X, r.Y, r.Width, r.Height, max));
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
            {
                // not being able to remember the window is never worth an error box
            }
        }
    }
}
