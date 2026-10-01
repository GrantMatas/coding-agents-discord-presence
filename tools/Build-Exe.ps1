$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$artifactDir = Join-Path $root 'artifacts'
$output = Join-Path $artifactDir 'CodexDiscordPresence.exe'
$consoleOutput = Join-Path $artifactDir 'CodexDiscordPresence.Console.exe'
$blob = Join-Path $artifactDir 'codex-presence.blob'
$bundle = Join-Path $artifactDir 'codex-presence.bundle.js'
$configPath = Join-Path $artifactDir 'sea-config.json'
$node = (Get-Command node.exe -ErrorAction Stop).Source

& $node (Join-Path $root 'tools\bundle.js')
if ($LASTEXITCODE -ne 0) { throw 'JavaScript bundling failed.' }
$seaConfig = @{ main = $bundle; output = $blob; disableExperimentalSEAWarning = $true; execArgv = @('--disable-warning=ExperimentalWarning') } | ConvertTo-Json
[System.IO.File]::WriteAllText($configPath, $seaConfig, [System.Text.UTF8Encoding]::new($false))
& $node --experimental-sea-config $configPath
if ($LASTEXITCODE -ne 0) { throw 'Node SEA blob generation failed.' }
Copy-Item -LiteralPath $node -Destination $output -Force

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class SeaResource {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool UpdateResource(IntPtr update, IntPtr type, string name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResource(IntPtr update, bool discard);
    public static void Inject(string fileName, byte[] blob) {
        IntPtr handle = BeginUpdateResource(fileName, false);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        bool committed = false;
        try {
            if (!UpdateResource(handle, new IntPtr(10), "NODE_SEA_BLOB", 0, blob, (uint)blob.Length))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!EndUpdateResource(handle, false)) throw new Win32Exception(Marshal.GetLastWin32Error());
            committed = true;
        } finally { if (!committed) EndUpdateResource(handle, true); }
    }
    public static void PatchFuse(string fileName) {
        using (var stream = new FileStream(fileName, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite)) {
            byte[] bytes = new byte[checked((int)stream.Length)];
            int count = 0;
            while (count < bytes.Length) count += stream.Read(bytes, count, bytes.Length - count);
            byte[] needle = Encoding.ASCII.GetBytes("NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0");
            for (int i = 0; i <= bytes.Length - needle.Length; i++) {
                if (bytes[i] != needle[0]) continue;
                bool match = true;
                for (int j = 1; j < needle.Length; j++) {
                    if (bytes[i + j] != needle[j]) { match = false; break; }
                }
                if (!match) continue;
                stream.Position = i + needle.Length - 1;
                stream.WriteByte((byte)'1');
                return;
            }
        }
        throw new InvalidOperationException("Node SEA fuse was not found in the EXE.");
    }
    public static void MakeGui(string fileName) {
        using (var stream = new FileStream(fileName, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite)) {
            byte[] value = new byte[4];
            stream.Position = 0x3c;
            if (stream.Read(value, 0, 4) != 4) throw new InvalidOperationException("Invalid Windows executable.");
            int pe = BitConverter.ToInt32(value, 0);
            if (pe < 0 || pe + 96 >= stream.Length) throw new InvalidOperationException("Invalid Windows executable.");
            stream.Position = pe;
            if (stream.Read(value, 0, 2) != 2 || value[0] != 'P' || value[1] != 'E')
                throw new InvalidOperationException("Invalid Windows executable.");
            int subsystem = pe + 24 + 68;
            stream.Position = subsystem;
            if (stream.Read(value, 0, 2) != 2 || BitConverter.ToUInt16(value, 0) != 3)
                throw new InvalidOperationException("Expected a console executable.");
            stream.Position = subsystem;
            stream.WriteByte(2);
            stream.WriteByte(0);
        }
    }
}
'@
[SeaResource]::Inject($output, [System.IO.File]::ReadAllBytes($blob))
[SeaResource]::PatchFuse($output)
Copy-Item -LiteralPath $output -Destination $consoleOutput -Force
[SeaResource]::MakeGui($output)
Write-Host "Built $output"
