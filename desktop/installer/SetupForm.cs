using System;
using System.Drawing;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace OddlyClever
{
    /// <summary>The one-screen installer: what it is, that it's free, one button.</summary>
    sealed class SetupForm : Form
    {
        static readonly Color Paper = Color.FromArgb(0xff, 0xf4, 0xe3);
        static readonly Color Ink = Color.FromArgb(0x16, 0x12, 0x1b);
        static readonly Color Pink = Color.FromArgb(0xff, 0x2e, 0x7e);

        readonly CheckBox desktop = new CheckBox { Text = "Add a shortcut to my desktop", Checked = true, AutoSize = true };
        readonly ProgressBar bar = new ProgressBar { Visible = false, Dock = DockStyle.Fill };
        readonly Label status = new Label { AutoSize = true, ForeColor = Color.FromArgb(0x5a, 0x52, 0x60) };
        readonly Button primary = new Button { Text = "Install", AutoSize = true, FlatStyle = FlatStyle.Flat, BackColor = Pink, ForeColor = Color.White };
        readonly Button secondary = new Button { Text = "Cancel", AutoSize = true, FlatStyle = FlatStyle.Flat };
        bool installed;

        public SetupForm()
        {
            Text = "Install " + Product.Name;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            BackColor = Paper;
            ForeColor = Ink;
            Font = new Font("Segoe UI", 10f);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;

            int px(int v) => v * DeviceDpi / 96;
            var logo = new PictureBox { SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(px(88), px(88)), Margin = new Padding(0, 0, px(20), 0) };
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("logo.png"))
                if (s != null) logo.Image = Image.FromStream(s);

            var text = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, MaximumSize = new Size(px(420), 0) };
            text.Controls.Add(new Label { Text = Product.Name, AutoSize = true, Font = new Font("Segoe UI Semibold", 18f), Margin = new Padding(0, 0, 0, px(6)) });
            text.Controls.Add(Para("A free PDF editor for your PC. Edit, sign, fill in, merge and convert PDFs."));
            text.Controls.Add(Para("It's free, there's no account to make, and your files stay on this computer."));
            text.Controls.Add(Para("It installs just for you, so it doesn't need admin rights.", small: true));
            desktop.Margin = new Padding(0, px(10), 0, px(10));
            text.Controls.Add(desktop);
            bar.Height = px(14);
            bar.Width = px(420);
            bar.Dock = DockStyle.None;
            text.Controls.Add(bar);
            text.Controls.Add(status);

            // flat buttons otherwise read as plain panes to screen readers
            primary.AccessibleRole = secondary.AccessibleRole = AccessibleRole.PushButton;
            desktop.AccessibleRole = AccessibleRole.CheckButton;
            primary.FlatAppearance.BorderColor = Ink;
            primary.Padding = new Padding(px(12), px(2), px(12), px(2));
            secondary.FlatAppearance.BorderColor = Ink;
            secondary.Padding = new Padding(px(8), px(2), px(8), px(2));
            var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Bottom, Margin = new Padding(0, px(16), 0, 0) };
            buttons.Controls.Add(primary);
            buttons.Controls.Add(secondary);

            var grid = new TableLayoutPanel { ColumnCount = 2, RowCount = 2, AutoSize = true, Padding = new Padding(px(18), px(18), px(18), px(12)) };
            grid.Controls.Add(logo, 0, 0);
            grid.Controls.Add(text, 1, 0);
            grid.Controls.Add(buttons, 1, 1);
            Controls.Add(grid);

            AcceptButton = primary;
            primary.Click += async (s, e) => { if (installed) { Installer.Launch(); Close(); } else await InstallAsync(); };
            secondary.Click += (s, e) => Close();
        }

        Label Para(string s, bool small = false) => new Label
        {
            Text = s, AutoSize = true, MaximumSize = new Size(420 * DeviceDpi / 96, 0), Margin = new Padding(0, 2, 0, 2),
            Font = small ? new Font("Segoe UI", 9f) : null,
            ForeColor = small ? Color.FromArgb(0x5a, 0x52, 0x60) : Ink,
        };

        async Task InstallAsync()
        {
            primary.Enabled = secondary.Enabled = desktop.Enabled = false;
            bar.Visible = true;
            status.Text = "Installing...";
            var progress = new Progress<int>(v => bar.Value = Math.Min(100, v));
            bool wantDesktop = desktop.Checked;
            while (true)
            {
                try
                {
                    await Task.Run(() => Installer.Run(wantDesktop, p => ((IProgress<int>)progress).Report(p)));
                    break;
                }
                catch (AppRunningException e)
                {
                    if (MessageBox.Show(this, e.Message, Text, MessageBoxButtons.RetryCancel, MessageBoxIcon.Information) != DialogResult.Retry)
                    { Reset("Not installed. Close OddlyClever PDF and run this again."); return; }
                }
                catch (Exception e)
                {
                    MessageBox.Show(this, "Sorry, the install didn't finish:\n\n" + e.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Reset("Not installed.");
                    return;
                }
            }
            installed = true;
            status.Text = "All done. You'll find it in the Start menu" + (wantDesktop ? " and on your desktop." : ".");
            primary.Text = "Open " + Product.Name;
            secondary.Text = "Close";
            primary.Enabled = secondary.Enabled = true;
            primary.Focus();
        }

        void Reset(string message)
        {
            status.Text = message;
            bar.Visible = false;
            primary.Enabled = secondary.Enabled = desktop.Enabled = true;
        }
    }
}
