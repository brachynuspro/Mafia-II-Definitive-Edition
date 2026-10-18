using System;
using System.IO;
using System.Runtime.InteropServices;

namespace Fsb5ToWav;

// Conversor FSB5 -> WAV usando fmod64.dll (FMOD 5.0)
// uso: Fsb5ToWav <input.fsb5> <output.wav>
class Program {
    const string DLL = "fmod64.dll";

    [DllImport(DLL, EntryPoint="FMOD_System_Create")]
    static extern int FMOD_System_Create(out IntPtr system);

    [DllImport(DLL, EntryPoint="FMOD_System_Release")]
    static extern int FMOD_System_Release(IntPtr system);

    [DllImport(DLL, EntryPoint="FMOD_System_Init")]
    static extern int FMOD_System_Init(IntPtr system, int maxChannels, int flags, IntPtr driverData);

    [DllImport(DLL, EntryPoint="FMOD_System_Update")]
    static extern int FMOD_System_Update(IntPtr system);

    [DllImport(DLL, EntryPoint="FMOD_System_CreateSound")]
    static extern int FMOD_System_CreateSound(IntPtr system, byte[] data, int mode, ref FMOD_CREATESOUNDEXINFO exinfo, out IntPtr sound);

    [DllImport(DLL, EntryPoint="FMOD_Sound_Release")]
    static extern int FMOD_Sound_Release(IntPtr sound);

    [DllImport(DLL, EntryPoint="FMOD_Sound_GetFormat")]
    static extern int FMOD_Sound_GetFormat(IntPtr sound, out int type, out int format, out int channels, out int bits);

    [DllImport(DLL, EntryPoint="FMOD_Sound_GetLength")]
    static extern int FMOD_Sound_GetLength(IntPtr sound, out uint length, int timeunit);

    [DllImport(DLL, EntryPoint="FMOD_Sound_GetDefaults")]
    static extern int FMOD_Sound_GetDefaults(IntPtr sound, out float frequency, out int priority);

    [DllImport(DLL, EntryPoint="FMOD_Sound_GetNumSubSounds")]
    static extern int FMOD_Sound_GetNumSubSounds(IntPtr sound, out int count);

    [DllImport(DLL, EntryPoint="FMOD_Sound_GetSubSound")]
    static extern int FMOD_Sound_GetSubSound(IntPtr sound, int index, out IntPtr subsound);

    [DllImport(DLL, EntryPoint="FMOD_Sound_Lock")]
    static extern int FMOD_Sound_Lock(IntPtr sound, uint offset, uint length, out IntPtr ptr1, out IntPtr ptr2, out uint len1, out uint len2);

    [DllImport(DLL, EntryPoint="FMOD_Sound_Unlock")]
    static extern int FMOD_Sound_Unlock(IntPtr sound, IntPtr ptr1, IntPtr ptr2, uint len1, uint len2);

    [DllImport(DLL, EntryPoint="FMOD_Sound_GetOpenState")]
    static extern int FMOD_Sound_GetOpenState(IntPtr sound, out int openstate, out uint percentbufferused, out int starving, out int diskbusy);

    [DllImport(DLL, EntryPoint="FMOD_Sound_ReadData")]
    static extern int FMOD_Sound_ReadData(IntPtr sound, IntPtr buffer, uint lengthBytes, out uint read);

    [StructLayout(LayoutKind.Sequential)]
    struct FMOD_CREATESOUNDEXINFO {
        public int cbsize;
        public uint length;
        public uint fileoffset;
        public int numchannels;
        public int defaultfrequency;
        public int format;
        public uint decodebuffersize;
        public int initialsubsound;
        public int numsubsounds;
        public IntPtr inclusivelist;
        public int inclusivelistnum;
        public IntPtr pcmreadcallback;
        public IntPtr pcmsetposcallback;
        public IntPtr nonpcmcallback;
        public IntPtr dlsname;
        public IntPtr encryptionkey;
        public int maxpolyphony;
        public IntPtr userdata;
        public int suggestedsoundtype;
        public int useropen;
        public int userclose;
        public int userread;
        public int userseek;
        public int userasyncread;
        public int userasynccancel;
        public IntPtr filehandle;
        public uint filehandleoffset;
        public int channelorder;
        public int channelmask;
    }

    const int FMOD_MODE_CREATESAMPLE = 0x00000004;
    const int FMOD_MODE_OPENMEMORY = 0x00000800;
    const int FMOD_MODE_CREATECOMPRESSEDSAMPLE = 0x00000200;
    const int FMOD_MODE_NONBLOCKING = 0x00000010;
    const int FMOD_INIT_NORMAL = 0x0;
    const int FMOD_TIMEUNIT_PCM = 0x00000020;
    const int FMOD_SOUND_FORMAT_PCM16 = 2;

    static int Main(string[] args) {
        if (args.Length < 2) {
            Console.Error.WriteLine("uso: Fsb5ToWav <in.fsb5> <out.wav>");
            return 1;
        }
        string inPath = args[0];
        string outPath = args[1];
        if (!File.Exists(inPath)) { Console.Error.WriteLine("nao existe: " + inPath); return 2; }

        // copia fmod64.dll para o local se nao estiver
        string gameBin = @"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\pc";
        string localDll = Path.Combine(AppContext.BaseDirectory, "fmod64.dll");
        if (!File.Exists(localDll) && File.Exists(Path.Combine(gameBin, "fmod64.dll"))) {
            File.Copy(Path.Combine(gameBin, "fmod64.dll"), localDll, false);
        }

        byte[] fsb5 = File.ReadAllBytes(inPath);

        int rc;
        rc = FMOD_System_Create(out IntPtr sys);
        if (rc != 0) { Console.Error.WriteLine("FMOD_System_Create rc=" + rc); return 3; }
        rc = FMOD_System_Init(sys, 32, FMOD_INIT_NORMAL, IntPtr.Zero);
        if (rc != 0) { Console.Error.WriteLine("FMOD_System_Init rc=" + rc); return 3; }

        var ex = new FMOD_CREATESOUNDEXINFO();
        ex.cbsize = Marshal.SizeOf<FMOD_CREATESOUNDEXINFO>();
        ex.length = (uint)fsb5.Length;
        ex.fileoffset = 0;

        rc = FMOD_System_CreateSound(sys, fsb5, FMOD_MODE_CREATESAMPLE | FMOD_MODE_OPENMEMORY | FMOD_MODE_NONBLOCKING, ref ex, out IntPtr sound);
        if (rc != 0) {
            rc = FMOD_System_CreateSound(sys, fsb5, FMOD_MODE_CREATECOMPRESSEDSAMPLE | FMOD_MODE_OPENMEMORY | FMOD_MODE_NONBLOCKING, ref ex, out sound);
            if (rc != 0) { Console.Error.WriteLine("FMOD_System_CreateSound rc=" + rc); FMOD_System_Release(sys); return 4; }
        }
        // espera abrir
        int tries = 0;
        do {
            rc = FMOD_Sound_GetOpenState(sound, out int openState, out uint percent, out int starv, out int disk);
            tries++;
            if (rc == 0 && openState == 0) break; // FMOD_OPENSTATE_READY
            FMOD_System_Update(sys);
            System.Threading.Thread.Sleep(100);
        } while (tries < 100);
        Console.Error.WriteLine("openState=" + rc + " after " + tries + " tries");

        rc = FMOD_Sound_GetNumSubSounds(sound, out int nsub);
        Console.Error.WriteLine("subsounds: " + nsub);

        for (int sub = 0; sub < Math.Max(1, nsub); sub++) {
            IntPtr snd = sound;
            if (nsub > 0) {
                rc = FMOD_Sound_GetSubSound(sound, sub, out snd);
                if (rc != 0) { Console.Error.WriteLine("GetSubSound " + sub + " rc=" + rc); continue; }
            }
            rc = FMOD_Sound_GetFormat(snd, out int type, out int fmt, out int ch, out int bits);
            if (rc != 0) { Console.Error.WriteLine("GetFormat " + sub + " rc=" + rc); continue; }
            uint sampleRate = 0;
            FMOD_Sound_GetDefaults(snd, out float freq, out int prio);
            sampleRate = (uint)freq;
            rc = FMOD_Sound_GetLength(snd, out uint pcmLen, FMOD_TIMEUNIT_PCM);
            if (rc != 0 || pcmLen == 0) {
                // tenta MS
                rc = FMOD_Sound_GetLength(snd, out uint msLen, 1);
                Console.Error.WriteLine($"sub {sub}: ch={ch} bits={bits} freq={sampleRate} msLen(ms)={msLen} (rc={rc})");
                if (msLen == 0) continue;
                pcmLen = (uint)(msLen * sampleRate / 1000);
            }
            uint bytesPerSample = (uint)(bits / 8);
            uint totalBytes = (uint)(pcmLen * (uint)ch * bytesPerSample);
            if (totalBytes == 0) { Console.Error.WriteLine("skip " + sub + ": empty"); continue; }
            Console.Error.WriteLine($"sub {sub}: ch={ch} bits={bits} freq={sampleRate} pcmLen={pcmLen} totalBytes={totalBytes}");

            // ReadData (com fallback para Sound_Lock)
            IntPtr buf = Marshal.AllocHGlobal((int)totalBytes);
            IntPtr p1 = IntPtr.Zero, p2 = IntPtr.Zero;
            uint l1 = 0, l2 = 0;
            uint read = 0;
            try {
                // tenta ReadData primeiro (funciona para compressed samples depois de update)
                rc = FMOD_Sound_ReadData(snd, buf, totalBytes, out read);
                if (rc != 0) {
                    // fallback: Sound_Lock com offset 0, length totalBytes
                    rc = FMOD_Sound_Lock(snd, 0, totalBytes, out p1, out p2, out l1, out l2);
                    if (rc != 0) { Console.Error.WriteLine("Lock rc=" + rc); continue; }
                    read = l1 + l2;
                    // copia p1
                    int total = (int)(l1 + l2);
                    byte[] pcm = new byte[total];
                    if (l1 > 0) Marshal.Copy(p1, pcm, 0, (int)l1);
                    if (l2 > 0) Marshal.Copy(p2, pcm, (int)l1, (int)l2);
                    FMOD_Sound_Unlock(snd, p1, p2, l1, l2);

                    string subOut = nsub > 1 ? outPath.Replace(".wav", $"_sub{sub}.wav") : outPath;
                    WriteWav(subOut, pcm, (ushort)ch, sampleRate, (ushort)bits);
                    Console.Error.WriteLine("escrito: " + subOut + " (" + pcm.Length + " bytes)");
                } else {
                    byte[] pcm = new byte[read];
                    Marshal.Copy(buf, pcm, 0, (int)read);
                    string subOut = nsub > 1 ? outPath.Replace(".wav", $"_sub{sub}.wav") : outPath;
                    WriteWav(subOut, pcm, (ushort)ch, sampleRate, (ushort)bits);
                    Console.Error.WriteLine("escrito: " + subOut + " (" + pcm.Length + " bytes)");
                }
            } finally {
                Marshal.FreeHGlobal(buf);
            }
        }

        FMOD_Sound_Release(sound);
        FMOD_System_Release(sys);
        return 0;
    }

    static void WriteWav(string path, byte[] pcm, ushort channels, uint sampleRate, ushort bitsPerSample) {
        using var fs = new FileStream(path, FileMode.Create);
        using var bw = new BinaryWriter(fs);
        uint byteRate = (uint)(sampleRate * channels * (bitsPerSample / 8));
        ushort blockAlign = (ushort)(channels * (bitsPerSample / 8));
        uint dataSize = (uint)pcm.Length;
        uint riffSize = 36 + dataSize;

        bw.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
        bw.Write(riffSize);
        bw.Write(System.Text.Encoding.ASCII.GetBytes("WAVE"));
        bw.Write(System.Text.Encoding.ASCII.GetBytes("fmt "));
        bw.Write((uint)16);
        bw.Write((ushort)1);  // PCM
        bw.Write(channels);
        bw.Write(sampleRate);
        bw.Write(byteRate);
        bw.Write(blockAlign);
        bw.Write(bitsPerSample);
        bw.Write(System.Text.Encoding.ASCII.GetBytes("data"));
        bw.Write(dataSize);
        bw.Write(pcm);
    }
}
