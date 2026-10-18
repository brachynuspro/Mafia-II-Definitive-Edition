// FmodProbe - mede a duracao real de cada banco FSB5 usando a API FMOD Ex do proprio jogo.
// FMOD e quem decodifica o Vorbis, entao o comprimento reportado e exatamente o que o jogo usa.
// uso: FmodProbe <pasta-do-jogo\pc> <pasta-com-os-fsb5> <csv-de-saida> [limite]
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

// ---------- bindings FMOD Ex ----------
internal static class FMOD
{
    // a API C real e exportada como FMOD_System_*; FMOD_Init e FMOD_CreateSound sao
    // macros do header e nao existem como simbolos na DLL
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_System_Init(IntPtr system, int flags, IntPtr extra);
    // a assinatura real tem 5 parametros: o exinfo no final. Omitir esse argumento
    // passa lixo no stack e a API responde INVALID_PARAM.
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_System_CreateSound(IntPtr system, byte[] data, int mode, out IntPtr sound, IntPtr exinfo);
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_Sound_Release(IntPtr sound);
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_Sound_GetLength(IntPtr sound, int lengthtype, out uint length);
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_Sound_GetFormat(IntPtr sound, out int type, out int channels, out int bits);
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_Sound_GetFrequency(IntPtr sound, out int freq, out IntPtr units);
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_Sound_GetNumSubSounds(IntPtr sound, out int count);
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_Sound_GetSubSound(IntPtr sound, int index, out IntPtr sub);
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_System_Create(out IntPtr system);
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_System_SetOutput(IntPtr system, int output);
    [DllImport("fmodex64", CallingConvention = CallingConvention.Cdecl)] public static extern int FMOD_System_Release(IntPtr system);

    public const int FMOD_DEFAULT = 0x00000000;
    public const int FMOD_CREATESAMPLE = 0x00000000;
    public const int FMOD_OPENMEMORY_POINT = 0x00000010;
    // OPENMEMORY (0x08) COPIA os dados; OPENMEMORY_POINT exige a memoria fixada
    // durante toda a vida do som, o que nao da para fazer com um byte[] managed.
    public const int FMOD_OPENMEMORY = 0x00000008;
    // o bank e Vorbis comprimido: FMOD_CREATESAMPLE(0) espera PCM cru e devolve
    // INVALID_PARAM. Para conteudo comprimido e preciso CREATECOMPRESSEDSAMPLE.
    public const int FMOD_CREATECOMPRESSEDSAMPLE = 0x00000002;
    public const int FMOD_CREATESTREAM = 0x00000001;
    public const int FMOD_CREATECOMPRESSEDSTREAM = 0x00000004;
    public const int FMOD_LENGTHMS = 0x00004100;
    public const int FMOD_OUTPUTTYPE_NOSOUND = 0x00000007;
    public const int FMOD_STUDIO_DEFAULT = 0x00000000;
}

internal static class Program
{
    static int Main(string[] argv)
    {
        if (argv.Length < 3)
        {
            Console.Error.WriteLine("uso: FmodProbe <pasta-do-jogo\\pc> <pasta-fsb5> <saida.csv> [limite]");
            return 2;
        }
        string pcDir = argv[0];
        string fsbDir = argv[1];
        string outCsv = argv[2];
        int limit = int.MaxValue;
        int modeSel = 0;
        // aceita argumentos extras ao final: primeiro numero eh limite, segundo eh modo
        // assim paths com espacos (e.g. "Mafia II Definitive Edition\pc") nao sao parseados
        for (int i = 3; i < argv.Length; i++)
        {
            if (int.TryParse(argv[i], out int n))
            {
                if (limit == int.MaxValue) limit = n;
                else if (modeSel == 0) modeSel = n;
            }
        }

        // o jogo traz fmod64.dll; o probe roda ao lado dele para resolver a mesma versao
        Environment.CurrentDirectory = pcDir;
        AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
        {
            string n = new AssemblyName(e.Name).Name;
            string p = Path.Combine(pcDir, n + ".dll");
            return File.Exists(p) ? Assembly.LoadFrom(p) : null;
        };

        int rc = FMOD.FMOD_System_Create(out IntPtr sys);
        if (rc != 0) { Console.Error.WriteLine($"FMOD_System_create = {rc}"); return 3; }
        FMOD.FMOD_System_SetOutput(sys, FMOD.FMOD_OUTPUTTYPE_NOSOUND);
        rc = FMOD.FMOD_System_Init(sys, FMOD.FMOD_STUDIO_DEFAULT, IntPtr.Zero);
        if (rc != 0) { Console.Error.WriteLine($"FMOD_System_Init = {rc}"); return 4; }

        // suporta .fsb5 e .fsb (este jogo usa .fsb nos banks de musica/radio)
        var files = Directory.EnumerateFiles(fsbDir, "*.fsb*", SearchOption.AllDirectories)
                        .OrderBy(x => x, StringComparer.Ordinal).ToList();
        Console.WriteLine($"bancos encontrados: {files.Count}");
        if (files.Count > limit) files = files.Take(limit).ToList();

        var sb = new StringBuilder();
        sb.AppendLine("arquivo;slot;duracao_ms;amostras;canais;freq_hz;bytes;erro");

        int ok = 0, fail = 0;
        foreach (var f in files)
        {
            string rel = Path.GetRelativePath(fsbDir, f);
            string slot = Path.GetFileNameWithoutExtension(f);
            string err = "";
            uint ms = 0; int ch = 0, freq = 0; int samples = 0;
            IntPtr snd = IntPtr.Zero;
            try
            {
                byte[] data = File.ReadAllBytes(f);
                int off = IndexOfFsb5(data);
                byte[] bank = off > 0 ? data[off..] : data;
                // este build do FMOD e anterior ao 5.0.20 (a API C nao expoe
                // SetSoftwareFormat/SetDSPBufferSize) e alguns modos derrubam o processo
                // com access violation, entao cada modo e testado isoladamente.
                int[] modes = {
                    FMOD.FMOD_OPENMEMORY,
                    FMOD.FMOD_CREATECOMPRESSEDSAMPLE | FMOD.FMOD_OPENMEMORY,
                    FMOD.FMOD_CREATESTREAM | FMOD.FMOD_OPENMEMORY,
                    FMOD.FMOD_CREATECOMPRESSEDSTREAM | FMOD.FMOD_OPENMEMORY,
                    FMOD.FMOD_OPENMEMORY_POINT,
                };
                int m = modes[Math.Clamp(modeSel, 0, modes.Length - 1)];
                rc = FMOD.FMOD_System_CreateSound(sys, bank, m, out IntPtr probe, IntPtr.Zero);
                if (rc == 0)
                {
                    snd = probe; err = "";
                    IntPtr target = snd;
                    FMOD.FMOD_Sound_GetNumSubSounds(snd, out int nsub);
                    if (nsub > 0) { FMOD.FMOD_Sound_GetSubSound(snd, 0, out target); }
                    FMOD.FMOD_Sound_GetLength(target, FMOD.FMOD_LENGTHMS, out ms);
                    FMOD.FMOD_Sound_GetFormat(target, out _, out ch, out _);
                    FMOD.FMOD_Sound_GetFrequency(target, out freq, out _);
                    samples = freq > 0 ? (int)(ms * freq / 1000) : 0;
                    ok++;
                }
                else err = $"modo={m:X}_rc={rc}";
            }
            catch (Exception e) { err = e.GetType().Name; fail++; }
            finally { if (snd != IntPtr.Zero) FMOD.FMOD_Sound_Release(snd); }
            if (err.Length > 0) fail++;
            sb.AppendLine($"\"{rel}\";\"{slot}\";{ms};{samples};{ch};{freq};{new FileInfo(f).Length};\"{err}\"");
            if ((ok + fail) % 500 == 0) Console.WriteLine($"  {ok + fail}/{files.Count}  ok={ok} erro={fail}");
        }

        File.WriteAllText(outCsv, sb.ToString(), new UTF8Encoding(true));
        Console.WriteLine($"ok={ok}  erro={fail}");
        Console.WriteLine($"saida: {outCsv}");

        FMOD.FMOD_System_Release(sys);
        return 0;
    }

    static int IndexOfFsb5(byte[] d)
    {
        for (int i = 0; i < Math.Min(d.Length - 4, 512); i++)
            if (d[i] == (byte)'F' && d[i + 1] == (byte)'S' && d[i + 2] == (byte)'B' && d[i + 3] == (byte)'5') return i;
        return -1;
    }
}
