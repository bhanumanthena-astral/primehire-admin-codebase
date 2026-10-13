import csv
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

directory = Path(__file__).resolve().parent
payload = json.loads((directory/'open-bugs-data.json').read_text(encoding='utf-8'))
target = directory/'PrimeHire_Open_Reopened_Bug_Notes.xlsx'
ns = {'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with Path(payload['source']).open(encoding='utf-8-sig',newline='') as handle:
    original = {int(row['ID']):row for row in csv.DictReader(handle,delimiter='\t') if row.get('ID','').isdigit()}
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    workbook = ET.fromstring(archive.read('xl/workbook.xml'))
    assert [s.attrib['name'] for s in workbook.findall('m:sheets/m:sheet',ns)] == ['Open and reopened','Copy guide']
    shared=[]
    if 'xl/sharedStrings.xml' in archive.namelist():
        shared = [''.join(n.text or '' for n in item.findall('.//m:t',ns)) for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si',ns)]
    worksheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    cells = {cell.attrib['r']:cell for cell in worksheet.findall('m:sheetData/m:row/m:c',ns)}
    def value(address):
        cell=cells.get(address)
        if cell is None:return None
        raw=cell.findtext('m:v',namespaces=ns)
        if cell.attrib.get('t')=='s':return shared[int(raw)]
        if cell.attrib.get('t')=='inlineStr':return ''.join(n.text or '' for n in cell.findall('.//m:t',ns))
        return raw
    for row_index,expected in enumerate([payload['headers'],*payload['rows']],1):
        for column,text in enumerate(expected):
            actual=value(f'{chr(65+column)}{row_index}')
            if row_index>1 and column==0:assert int(float(actual))==text
            else:assert actual==text,(row_index,column,actual,text)
    assert len(payload['rows'])==20
    for row in payload['rows']:
        assert row[2]==original[row[0]]['Status']
    assert sum(row[3]=='Ready for manual retest' for row in payload['rows'])==17
    assert [row[0] for row in payload['rows'] if row[3]=='Needs investigation']==[60,61,62]
    pane=worksheet.find('m:sheetViews/m:sheetView/m:pane',ns)
    assert pane.attrib['xSplit']=='2' and pane.attrib['ySplit']=='1'
    table=ET.fromstring(archive.read('xl/tables/table1.xml'))
    assert table.attrib['ref']=='A1:G21' and table.find('m:autoFilter',ns) is not None
    guide=ET.fromstring(archive.read('xl/worksheets/sheet2.xml'))
    guide_text='\n'.join(node.text or '' for node in guide.iter())+'\n'.join(shared)
    for _,mapping in payload['batches']:assert mapping in guide_text
print(json.dumps({'file':str(target),'rows':20,'code_fixes':17,'needs_investigation':[60,61,62],'copy_columns':'E:G to T:V','result':'passed','bytes':target.stat().st_size}))
