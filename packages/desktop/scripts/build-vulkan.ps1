$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$work = Join-Path $root 'build/windows-native'
$out = Join-Path $root 'packages/desktop/resources/native'
New-Item -ItemType Directory -Force $work, $out | Out-Null
$pins = @(
  @{ Name = 'Vulkan-Headers'; Commit = 'b5c8f996196ba4aa6d8f97e52b5d3b6e70f7e4e2' },
  @{ Name = 'Vulkan-Loader'; Commit = '32fcb949e253cbeb40cda7ea76122b492db579ae' }
)
foreach ($pin in $pins) {
  $dir = Join-Path $work $pin.Name
  if (!(Test-Path (Join-Path $dir '.git'))) { git clone --filter=blob:none --no-checkout "https://github.com/KhronosGroup/$($pin.Name).git" $dir }
  git -C $dir checkout --detach $pin.Commit
  if ((git -C $dir rev-parse HEAD).Trim() -ne $pin.Commit) { throw 'Vulkan source pin mismatch' }
}
$headers = Join-Path $work 'headers-install'
cmake -S "$work/Vulkan-Headers" -B "$work/headers-build" "-DCMAKE_INSTALL_PREFIX=$headers" -DVULKAN_HEADERS_ENABLE_TESTS=OFF
cmake --build "$work/headers-build" --config Release
cmake --install "$work/headers-build" --config Release
cmake -S "$work/Vulkan-Loader" -B "$work/loader-build" -A x64 "-DCMAKE_PREFIX_PATH=$headers" "-DVULKAN_HEADERS_INSTALL_DIR=$headers" -DBUILD_TESTS=OFF -DBUILD_WERROR=OFF -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
cmake --build "$work/loader-build" --config Release --parallel 2
$dll = Get-ChildItem "$work/loader-build" -Filter vulkan-1.dll -Recurse | Select-Object -First 1
if (!$dll) { throw 'Vulkan loader DLL was not built' }
Copy-Item $dll.FullName "$out/vulkan-1.dll" -Force
$licenses = Join-Path $out 'licenses'
New-Item -ItemType Directory -Force $licenses | Out-Null
foreach ($pin in $pins) {
  Get-ChildItem "$work/$($pin.Name)" -Filter 'LICENSE*' | ForEach-Object { Copy-Item $_.FullName "$licenses/$($pin.Name)-$($_.Name)" -Force }
}
@{ loader = $pins[1].Commit; headers = $pins[0].Commit; sha256 = (Get-FileHash "$out/vulkan-1.dll" -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json | Set-Content "$out/provenance.json"
Write-Host 'Built the pinned Vulkan loader with a static MSVC runtime.'
$vswhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
$vs = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
if (!$vs) { throw 'Visual C++ redistributable directory is unavailable' }
$crt = Get-Item "$vs/VC/Redist/MSVC/*/x64/Microsoft.VC143.CRT" | Sort-Object FullName -Descending | Select-Object -First 1
if (!$crt) { throw 'The official Microsoft C++ runtime files are unavailable' }
$crtOut = Join-Path $out 'msvc'
New-Item -ItemType Directory -Force $crtOut | Out-Null
Get-ChildItem $crt.FullName -Filter '*.dll' | Copy-Item -Destination $crtOut -Force
@'
Microsoft Visual C++ Runtime, redistributed app-local from Visual Studio's licensed REDIST directory.
Redistribution terms: https://learn.microsoft.com/visualstudio/releases/2022/redistribution
Copyright Microsoft Corporation. All rights reserved.
'@ | Set-Content "$licenses/Microsoft-Visual-Cpp-Runtime.txt"
Get-ChildItem $crtOut -Filter '*.dll' | ForEach-Object {
  @{ file = $_.Name; version = $_.VersionInfo.FileVersion; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
} | ConvertTo-Json | Set-Content "$out/msvc-provenance.json"
