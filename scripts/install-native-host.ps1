param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId,

  [switch]$Snapshot
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoHostDir = Join-Path $repoRoot "src\host"
$nodePath = (Get-Command node).Source
$manifestDir = Join-Path $env:LOCALAPPDATA "ObsidianWebClipperLocal"
$hostInstallDir = Join-Path $manifestDir "host"
$activeHostDir = if ($Snapshot) { $hostInstallDir } else { $repoHostDir }
$launcherSourcePath = Join-Path $manifestDir "NativeHostLauncher.cs"
$launcherPath = Join-Path $manifestDir "native-host.exe"
$manifestPath = Join-Path $manifestDir "com.local.obsidian_web_clipper.json"

if ($Snapshot) {
  New-Item -ItemType Directory -Force -Path $hostInstallDir | Out-Null
  Copy-Item -Recurse -Force -Path (Join-Path $repoHostDir "*") -Destination $hostInstallDir
}

@"
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

public static class NativeHostLauncher
{
    public static int Main()
    {
        var psi = new ProcessStartInfo
        {
            FileName = @"$nodePath",
            Arguments = "\"" + @"$activeHostDir\index.ts" + "\"",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        var input = Console.OpenStandardInput();
        var header = new byte[4];
        ReadExact(input, header, 0, 4);
        var length = BitConverter.ToUInt32(header, 0);
        var payload = new byte[length];
        ReadExact(input, payload, 0, payload.Length);

        var payloadPath = Path.Combine(Path.GetTempPath(), "obsidian-web-clipper-" + Guid.NewGuid().ToString("N") + ".json");
        File.WriteAllBytes(payloadPath, payload);

        try
        {
            psi.Arguments = "\"" + @"$activeHostDir\handle-json-file.ts" + "\" \"" + payloadPath + "\"";
            using (var process = Process.Start(psi))
            {
                if (process == null)
                {
                    WriteNativeResponse("{'ok':false,'error':'Failed to start Node host'}".Replace("'", "\""));
                    return 1;
                }

                var output = process.StandardOutput.ReadToEnd();
                var error = process.StandardError.ReadToEnd();
                process.WaitForExit();

                if (!String.IsNullOrWhiteSpace(output))
                {
                    WriteNativeResponse(output.Trim());
                }
                else
                {
                    WriteNativeResponse(("{'ok':false,'error':'" + EscapeJson(error.Trim()) + "'}").Replace("'", "\""));
                }
                return process.ExitCode;
            }
        }
        finally
        {
            try { File.Delete(payloadPath); } catch {}
        }
    }

    private static void ReadExact(Stream stream, byte[] buffer, int offset, int count)
    {
        while (count > 0)
        {
            var read = stream.Read(buffer, offset, count);
            if (read <= 0)
            {
                throw new EndOfStreamException("Incomplete native message frame");
            }
            offset += read;
            count -= read;
        }
    }

    private static void WriteNativeResponse(string json)
    {
        var payload = new UTF8Encoding(false).GetBytes(json);
        var header = BitConverter.GetBytes((UInt32)payload.Length);
        var output = Console.OpenStandardOutput();
        output.Write(header, 0, header.Length);
        output.Write(payload, 0, payload.Length);
        output.Flush();
    }

    private static string EscapeJson(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }
}
"@ | Set-Content -Path $launcherSourcePath -Encoding UTF8

Add-Type -TypeDefinition (Get-Content -Raw -Path $launcherSourcePath) -OutputAssembly $launcherPath -OutputType ConsoleApplication

New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null

$manifest = @{
  name = "com.local.obsidian_web_clipper"
  description = "Obsidian Web Clipper Local Native Host"
  path = $launcherPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifestJson = $manifest | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($manifestPath, $manifestJson + [Environment]::NewLine, $utf8NoBom)

$chromeKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.local.obsidian_web_clipper"
$edgeKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.local.obsidian_web_clipper"
New-Item -Force -Path $chromeKey | Out-Null
Set-Item -Path $chromeKey -Value $manifestPath
New-Item -Force -Path $edgeKey | Out-Null
Set-Item -Path $edgeKey -Value $manifestPath

Write-Host "Native host installed:"
Write-Host $manifestPath
