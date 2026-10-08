import urllib.request
import json

data = json.dumps({
    'assessmentId': 'JOB-0AC93093',
    'name': 'QA Dev Candidate',
    'email': 'qa.dev@example.com',
    'phone': '+1999999999',
    'status': 'ACTIVE'
}).encode('utf-8')

req = urllib.request.Request(
    'http://127.0.0.1:8000/api/candidates',
    data=data,
    headers={'Content-Type': 'application/json'},
    method='POST'
)
with urllib.request.urlopen(req) as res:
    created = json.loads(res.read().decode('utf-8'))
    print('CREATED:', created['candidateKey'])

# Update test
update_data = json.dumps({
    'name': 'QA Dev Candidate Updated',
    'phone': '+1888888888'
}).encode('utf-8')

upd_req = urllib.request.Request(
    f"http://127.0.0.1:8000/api/candidates/{created['candidateKey']}",
    data=update_data,
    headers={'Content-Type': 'application/json'},
    method='PUT'
)
with urllib.request.urlopen(upd_req) as res:
    updated = json.loads(res.read().decode('utf-8'))
    print('UPDATED:', updated['name'], updated['phone'])

# Delete test
del_req = urllib.request.Request(
    f"http://127.0.0.1:8000/api/candidates/{created['candidateKey']}",
    method='DELETE'
)
with urllib.request.urlopen(del_req) as res:
    deleted = json.loads(res.read().decode('utf-8'))
    print('DELETED:', deleted)
