# Сверка расчёта строк с живым Excel.
# Читает tools\_rows_cases.json (готовит tools\dump_rows.cjs), для каждого случая
# ставит текст в ячейку нужной ширины с переносом, включает AutoFit строки и
# сравнивает число строк (15,75 pt = 1 строка) с расчётом metrics.js.
$ErrorActionPreference = "Stop"
$cases = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot "_rows_cases.json") | ConvertFrom-Json

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$book = $excel.Workbooks.Add()
$sheet = $book.Worksheets.Item(1)
$cell = $sheet.Range("A1")
$cell.Font.Name = "Times New Roman"
$cell.Font.Size = 12
$cell.WrapText = $true
$cell.VerticalAlignment = -4160

$bad = 0
$checked = 0
foreach ($c in $cases) {
  $chars = ($c.width / 7 * 256 - 18) / 256
  $sheet.Columns.Item(1).ColumnWidth = $chars
  $cell.Value2 = $c.text
  $sheet.Rows.Item(1).AutoFit() | Out-Null
  $excelLines = [math]::Round($sheet.Rows.Item(1).RowHeight / 15.75)
  $checked += 1
  if ($excelLines -ne $c.need) {
    $bad += 1
    "РАСХОЖДЕНИЕ Excel {0} / расчёт {1}  ширина {2} px  [{3}] {4}" -f $excelLines, $c.need, $c.width, $c.kind, $c.text
  }
}

"проверено $checked случаев, расхождений $bad"
$book.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
