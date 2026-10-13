import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

directory = Path(__file__).resolve().parent
payload = json.loads((directory / 'closed-bugs-data.json').read_text(encoding='utf-8'))
target = directory / 'PrimeHire_Closed_Bugs_Developer_Notes.xlsx'
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    workbook = ET.fromstring(archive.read('xl/workbook.xml'))
    assert [s.attrib['name'] for s in workbook.findall('m:sheets/m:sheet', ns)] == ['Closed bugs', 'Copy guide']
    shared = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si', ns):
            shared.append(''.join(n.text or '' for n in item.findall('.//m:t', ns)))
    worksheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    cells = {c.attrib['r']: c for c in worksheet.findall('m:sheetData/m:row/m:c', ns)}
    def value(address):
        cell = cells.get(address)
        if cell is None:
            return None
        raw = cell.findtext('m:v', namespaces=ns)
        if cell.attrib.get('t') == 's':
            return shared[int(raw)]
        if cell.attrib.get('t') == 'inlineStr':
            return ''.join(n.text or '' for n in cell.findall('.//m:t', ns))
        return raw
    for row_index, expected in enumerate([payload['headers'], *payload['rows']], 1):
        for column, original in enumerate(expected):
            actual = value(f'{chr(65+column)}{row_index}')
            if row_index > 1 and column == 0:
                assert int(float(actual)) == original
            else:
                assert (actual or '') == (original or ''), (row_index, column, actual, original)
    pane = worksheet.find('m:sheetViews/m:sheetView/m:pane', ns)
    assert pane.attrib['xSplit'] == '2' and pane.attrib['ySplit'] == '1'
    table = ET.fromstring(archive.read('xl/tables/table1.xml'))
    assert table.attrib['ref'] == 'A1:J34'
    assert table.find('m:autoFilter', ns) is not None
    guide = ET.fromstring(archive.read('xl/worksheets/sheet2.xml'))
    guide_text = '\n'.join(node.text or '' for node in guide.iter()) + '\n'.join(shared)
    for _, mapping in payload['batches']:
        assert mapping in guide_text, mapping
    assert len(payload['rows']) == 33 and all(row[2] == 'Closed' and row[3] is None for row in payload['rows'])
print(json.dumps({'file': str(target), 'closed_rows': 33, 'copy_batches': 7, 'frozen_identifiers': True, 'result': 'passed', 'bytes': target.stat().st_size}))
