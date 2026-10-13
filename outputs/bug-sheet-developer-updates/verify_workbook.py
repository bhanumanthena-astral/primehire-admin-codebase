import json
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

directory=Path(__file__).resolve().parent
file=directory/'PrimeHire_Developer_Bug_Updates.xlsx'
payload=json.loads((directory/'developer-data.json').read_text(encoding='utf-8'))
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(file) as archive:
    assert archive.testzip() is None
    workbook=ET.fromstring(archive.read('xl/workbook.xml'))
    assert [sheet.attrib['name'] for sheet in workbook.findall('m:sheets/m:sheet',ns)]==['Developer fields','Paste guide']
    strings=[]
    if 'xl/sharedStrings.xml' in archive.namelist():
        for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si',ns):
            strings.append(''.join(node.text or '' for node in item.iterfind('.//m:t',ns)))
    xml=ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    cells={cell.attrib['r']:cell for cell in xml.findall('m:sheetData/m:row/m:c',ns)}
    def value(address):
        cell=cells.get(address)
        if cell is None:return None
        raw=cell.findtext('m:v',default=None,namespaces=ns)
        if cell.attrib.get('t')=='s':return strings[int(raw)]
        if cell.attrib.get('t')=='inlineStr':return ''.join(node.text or '' for node in cell.iterfind('.//m:t',ns))
        return raw
    dates=0
    for row_index,expected in enumerate(payload['rows'],2):
        assert int(float(value(f'A{row_index}')))==expected[0]
        for column in [1,2,4,5,6,7,8]:
            actual=value(f'{chr(65+column)}{row_index}')
            assert (actual or '')==(expected[column] or ''),(row_index,column,actual,expected[column])
        date=expected[3]
        if date:
            cell=cells[f'D{row_index}']
            assert cell.attrib.get('t') not in ['s','inlineStr']
            if cell.attrib.get('t') == 'd':
                actual_date=datetime.fromisoformat(value(f'D{row_index}').replace('Z','+00:00')).date().isoformat()
                assert actual_date == date
            else:
                serial=(datetime.fromisoformat(date)-datetime(1899,12,30)).days
                assert int(float(value(f'D{row_index}')))==serial
            dates+=1
        else:assert value(f'D{row_index}') is None
    assert dates==19
    styles=ET.fromstring(archive.read('xl/styles.xml'))
    assert any(item.attrib.get('formatCode')=='dd/mm/yyyy' for item in styles.findall('m:numFmts/m:numFmt',ns))
    guide=ET.fromstring(archive.read('xl/worksheets/sheet2.xml'))
    text=ET.tostring(guide,encoding='unicode')+'\n'+'\n'.join(strings)
    for target in ['N2:N60','R2:V60','X2:X60']:assert target in text
    assert '59' in ET.tostring(xml,encoding='unicode')
print(json.dumps({'verified_file':str(file),'data_rows':59,'typed_dates':dates,'sheets':2,'copy_ranges':['C2:C60 to N2:N60','D2:H60 to R2:V60','I2:I60 to X2:X60'],'result':'passed'}))
