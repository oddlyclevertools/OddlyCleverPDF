using System;
using System.IO;

namespace OddlyClever
{
    /// <summary>Names and folders shared by the app, the installer and the uninstaller.</summary>
    internal static class Product
    {
        public const string Name = "OddlyClever PDF";
        public const string Publisher = "Oddly Clever Tools";
        public const string Id = "OddlyCleverPDF";
        public const string ExeName = "OddlyClever PDF.exe";
        public const string UninstallerName = "Uninstall OddlyClever PDF.exe";
        public const string ProgId = "OddlyClever.PDF";
        public const string Website = "https://oddlyclevertools.github.io/OddlyCleverPDF/";
        public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + Id;

        static readonly string LocalAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        /// <summary>%LOCALAPPDATA%\Programs\OddlyCleverPDF: where the program lives.</summary>
        public static string InstallDir => Path.Combine(LocalAppData, "Programs", Id);

        /// <summary>%LOCALAPPDATA%\OddlyCleverPDF: browser profile and window placement.</summary>
        public static string DataDir => Path.Combine(LocalAppData, Id);

        public static string StartMenuShortcut => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs), Name + ".lnk");

        public static string DesktopShortcut => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Name + ".lnk");
    }
}
