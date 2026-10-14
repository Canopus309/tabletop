# 학습할 때 필요 없는 프로그램 끄기 (사용자 요청 2026-10-14: "뱅가드, 스팀, 라이엇 클라 같은 쓸데없는 건 다 꺼, 학습할 때는 항상")
# 끄는 것: 스팀 · 라이엇 클라이언트 · 뱅가드 트레이 · OneDrive · 위젯. 두는 것: OMEN Gaming Hub (팬 설정), 브라우저 (사용 중일 수 있음)
# 관리자 권한이 필요한 서비스 · 드라이버(뱅가드 vgk 등)는 건드리지 않는다. run.js 가 시작할 때 한 번 부른다.
$closed = @()
# 스팀: 정상 종료 요청 후 남은 것 정리
$steam = Get-Process steam -ErrorAction SilentlyContinue | Select-Object -First 1
if ($steam -and $steam.Path) { try { Start-Process -FilePath $steam.Path -ArgumentList '-shutdown' -WindowStyle Hidden; Start-Sleep -Seconds 8 } catch {} }
foreach ($n in 'steam', 'steamwebhelper', 'RiotClientServices', 'RiotClientUx', 'RiotClientUxRender', 'RiotClientCrashHandler', 'vgtray', 'OneDrive', 'Widgets', 'WidgetService') {
  $ps = Get-Process $n -ErrorAction SilentlyContinue
  if ($ps) { $ps | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {} }; $closed += $n }
}
$left = Get-Process steam, steamwebhelper, RiotClientServices, vgtray, OneDrive -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique
"$(Get-Date -Format 'HH:mm:ss') 끔: $($closed -join ', ')$(if ($left) { ' · 남음: ' + ($left -join ', ') })"
