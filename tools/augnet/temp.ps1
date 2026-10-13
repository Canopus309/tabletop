# 온도 한 줄: CPU(ACPI 열 영역 \_tz.thrm, 관리자 권한 없이 읽힘) · GPU(nvidia-smi)
# 사용: powershell -File temp.ps1          → 한 번
#       powershell -File temp.ps1 -Every 5 → 5초마다 계속 (run.js 온도 지킴이가 씀)
param([int]$Every = 0)
function One {
  $cpu = $null
  try {
    $s = (Get-Counter '\Thermal Zone Information(*)\Temperature' -ErrorAction Stop).CounterSamples | Where-Object { $_.InstanceName -match 'thrm' } | Select-Object -First 1
    if ($s) { $cpu = [math]::Round($s.CookedValue - 273.15, 1) }
  } catch {}
  $gpu = (nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits) 2>$null
  [Console]::Out.WriteLine(("{0} cpu={1} gpu={2}" -f (Get-Date -Format 'HH:mm:ss'), $cpu, $gpu))
  [Console]::Out.Flush()
}
if ($Every -le 0) { One; exit }
while ($true) { One; Start-Sleep -Seconds $Every }
