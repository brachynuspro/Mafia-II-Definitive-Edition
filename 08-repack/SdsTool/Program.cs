// SdsTool - desempacota/empacota .sds v19 do Mafia II DE usando o codigo do MafiaToolkit (sem GUI).
// uso:
//   SdsTool unpack <arquivo.sds> <pasta-trabalho>   -> copia o .sds para a pasta e gera <pasta>\extracted\<nome>.sds\
//   SdsTool pack   <pasta-extraida> <saida.sds>     -> reconstroi o .sds a partir de SDSContent.xml + arquivos
//   SdsTool info   <arquivo.sds>                    -> lista recursos
using System; using System.IO; using System.Linq; using System.Reflection;
using Gibbed.Mafia2.FileFormats; using Gibbed.Mafia2.FileFormats.Archive; using Utils.Settings;

static class P {
  static readonly string TK = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, @"..\..\..\..\..\02-ferramentas\MafiaToolkit"));
  static int Main(string[] a) {
    var tk = Environment.GetEnvironmentVariable("MAFIATOOLKIT_DIR") ?? TK;
    AppDomain.CurrentDomain.AssemblyResolve += (s, e) => {
      var n = new AssemblyName(e.Name).Name + ".dll";
      foreach (var d in new[] { tk, Path.Combine(tk, "libs") }) { var f = Path.Combine(d, n); if (File.Exists(f)) return Assembly.LoadFrom(f); }
      return null; };
    try { return Run(a); } catch (Exception ex) { Console.Error.WriteLine("ERRO: " + ex); return 1; }
  }
  static void Init() {
    System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
    ToolkitSettings.CompressionRatio = 0.9f; ToolkitSettings.bUseOodleCompression = false;
    ToolkitSettings.bBackupEnabled = false; ToolkitSettings.DecompileLUA = false; ToolkitSettings.UseSDSToolFormat = false;
    ToolkitSettings.LoggingEnabled = false;
    var g = new Game("Mafia II: Definitive Edition", "", "", "M2DE_Directory", "M2DE_Materials", Utils.Settings.GamesEnumerator.MafiaII_DE);
    GameStorage.Instance.Games.Add(g); GameStorage.Instance.SetSelectedGame(g);
  }
  static ArchiveFile Load(string path) {
    var arc = new ArchiveFile(); arc.SetGameType(Utils.Settings.GamesEnumerator.MafiaII_DE);
    using var fs = File.OpenRead(path);
    using var s = ArchiveEncryption.Unwrap(fs);
    arc.Deserialize((Stream)s ?? fs);
    return arc;
  }
  static int Run(string[] a) {
    Init();
    if (a.Length < 2) { Console.Error.WriteLine("uso: SdsTool unpack|pack|info ..."); return 2; }
    switch (a[0]) {
      case "info": {
        var arc = Load(a[1]);
        Console.WriteLine($"versao={arc.Version} plataforma={arc.Platform} recursos={arc.ResourceEntries.Count}");
        foreach (var t in arc.ResourceTypes) Console.WriteLine($"  tipo {t.Id} {t.Name}");
        return 0; }
      case "unpack": {
        Directory.CreateDirectory(a[2]);
        var dst = Path.Combine(a[2], Path.GetFileName(a[1]));
        File.Copy(a[1], dst, true);
        var arc = Load(dst);
        arc.SaveResources(new FileInfo(dst));
        File.Delete(dst);
        Console.WriteLine("OK " + Path.Combine(a[2], "extracted", Path.GetFileName(a[1])));
        return 0; }
      case "pack": {
        var arc = new ArchiveFile();
        arc.Platform = Platform.PC; arc.SetGameType(Utils.Settings.GamesEnumerator.MafiaII_DE); arc.Version = 19u;
        if (!arc.BuildResources(Path.GetFullPath(a[1]))) { Console.Error.WriteLine("BuildResources falhou"); return 1; }
        if (arc.ResourceEntries.Any(e => e.Data == null)) { Console.Error.WriteLine("recurso sem dados"); return 1; }
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(a[2])));
        using (var o = File.Create(a[2])) arc.Serialize(o, ArchiveSerializeOptions.Compress);
        Console.WriteLine("OK " + a[2] + " recursos=" + arc.ResourceEntries.Count);
        return 0; }
    }
    return 2;
  }
}



