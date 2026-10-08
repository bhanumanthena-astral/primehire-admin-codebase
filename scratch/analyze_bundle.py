import urllib.request
import re

url = "https://elitehr.vils.ai/assets/index-Z4yfX5My.js"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
content = urllib.request.urlopen(req).read().decode("utf-8", errors="ignore")

print("Length of bundle:", len(content))

for match in re.finditer(r"http[s]?://[a-zA-Z0-9_\-\.:]+", content):
    print("URL found:", match.group(0))

for match in re.finditer(r"localhost", content, re.IGNORECASE):
    start = max(0, match.start() - 40)
    end = min(len(content), match.end() + 40)
    print("Localhost context:", content[start:end])

for match in re.finditer(r"/api/[a-zA-Z0-9_\-\/]+", content):
    print("API route:", match.group(0))
