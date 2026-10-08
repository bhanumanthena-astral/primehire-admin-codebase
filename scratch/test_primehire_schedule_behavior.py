import asyncio
import datetime
import json
import httpx
from pathlib import Path
import sys

# Load settings from backend
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.config import settings
from app.services.primehire_service import auth_headers

BASE_URL = settings.primehire_base_url
JOB_ID = "JOB-FF3748B2"
ROUND_TYPE = "BASIC"

def get_now():
    return datetime.datetime.now(datetime.timezone.utc)

def format_iso(dt: datetime.datetime):
    # Formats as YYYY-MM-DDTHH:mm:ss.SSS+00:00
    return dt.isoformat(timespec="milliseconds")

async def test_candidate(label, cand_id, start_dt, end_dt):
    headers = auth_headers(settings.primehire_access_key, settings.primehire_secret_key)
    headers["Content-Type"] = "application/json"
    
    start_str = format_iso(start_dt)
    end_str = format_iso(end_dt)
    
    payload = {
        "job_id": JOB_ID,
        "round_type": ROUND_TYPE,
        "candidates": [
            {
                "candidate_id": cand_id,
                "start_time": start_str,
                "end_time": end_str
            }
        ]
    }
    
    print(f"\n==========================================")
    print(f"CASE: {label}")
    print(f"Candidate: {cand_id}")
    print(f"Start: {start_str}")
    print(f"End:   {end_str}")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(f"{BASE_URL}/interview", json=payload, headers=headers)
            print(f"HTTP Status: {resp.status_code}")
            try:
                data = resp.json()
                print(f"Response JSON: {json.dumps(data, indent=2)}")
                return resp.status_code, data
            except Exception:
                print(f"Response Text: {resp.text}")
                return resp.status_code, resp.text
        except Exception as e:
            print(f"Request Exception: {e}")
            return 0, str(e)

async def main():
    now = get_now()
    print(f"Current UTC Now: {format_iso(now)}")
    
    # (a) start in future (+10 min), end in future (+2 hr)
    start_a = now + datetime.timedelta(minutes=10)
    end_a = now + datetime.timedelta(hours=2)
    cand_a = f"CAND-TEST-FUT-{int(now.timestamp()) % 100000}"
    await test_candidate("(a) Future start, Future end", cand_a, start_a, end_a)
    
    # (b) start a few minutes in past (-10 min), end in future (+2 hr)
    start_b = now - datetime.timedelta(minutes=10)
    end_b = now + datetime.timedelta(hours=2)
    cand_b = f"CAND-TEST-PASTSTART-{int(now.timestamp()) % 100000}"
    await test_candidate("(b) Past start (-10m), Future end (+2h)", cand_b, start_b, end_b)
    
    # (c) start equal to now, end in future (+2 hr)
    start_c = get_now()
    end_c = start_c + datetime.timedelta(hours=2)
    cand_c = f"CAND-TEST-NOW-{int(now.timestamp()) % 100000}"
    await test_candidate("(c) Start equal to now, Future end (+2h)", cand_c, start_c, end_c)
    
    # (d) end already in the past (-5 min), start in past (-1 hour)
    start_d = now - datetime.timedelta(hours=1)
    end_d = now - datetime.timedelta(minutes=5)
    cand_d = f"CAND-TEST-PASTEND-{int(now.timestamp()) % 100000}"
    await test_candidate("(d) End in the past (-5m), Start in past (-1h)", cand_d, start_d, end_d)

if __name__ == "__main__":
    asyncio.run(main())
