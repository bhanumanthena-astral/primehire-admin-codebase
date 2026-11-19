"""Versioned skill taxonomy and evidence extraction.

This module is import-safe inside the isolated parser children: it has no
FastAPI, motor, config or network imports. It is the single source of truth for
canonical skill names, aliases and the evidence used by ATS explanations.

Extraction deliberately errs on the side of *not* inventing a skill:
- aliases are symmetric, so "React", "React.js" and "ReactJS" resolve to React;
- a negated clause ("no experience with Java") never yields Java;
- ambiguous one-letter aliases (C, R) and common words (Go, Spring, Express,
  JS, TS, ML, AI) require case or section/list context;
- emails and URLs are masked before matching so contacts cannot create skills.
"""
from __future__ import annotations

import bisect
import re
from functools import lru_cache

TAXONOMY_VERSION = "skills-v3"
PARSER_VERSION = "resume-parser-v3"

# Canonical -> (aliases, category). Aliases are extra spellings, not the
# canonical display name. Keep entries curated: a noisy dictionary lowers
# precision and makes ATS explanations harder to trust.
_TAXONOMY: dict[str, tuple[list[str], str]] = {
    # Languages
    "Java": (["java"], "language"),
    "Python": (["python", "python3", "py"], "language"),
    "JavaScript": (["javascript", "java script", "js", "ecmascript", "es6"], "language"),
    "TypeScript": (["typescript", "type script", "ts"], "language"),
    "Go": (["golang", "go lang", "go"], "language"),
    "Rust": (["rust", "rustlang"], "language"),
    "C": (["c"], "language"),
    "C++": (["c++", "cpp", "c plus plus"], "language"),
    "C#": (["c#", "csharp", "c sharp"], "language"),
    "Kotlin": (["kotlin"], "language"),
    "Swift": (["swift"], "language"),
    "Scala": (["scala"], "language"),
    "R": (["r"], "language"),
    "Ruby": (["ruby"], "language"),
    "PHP": (["php"], "language"),
    "Dart": (["dart"], "language"),
    "Perl": (["perl"], "language"),
    "Haskell": (["haskell"], "language"),
    "Elixir": (["elixir"], "language"),
    "Erlang": (["erlang"], "language"),
    "Clojure": (["clojure"], "language"),
    "F#": (["f#", "fsharp"], "language"),
    "Objective-C": (["objective-c", "objective c", "objc"], "language"),
    "Visual Basic": (["visual basic", "vb.net", "vba"], "language"),
    "MATLAB": (["matlab"], "language"),
    "Julia": (["julia"], "language"),
    "Bash": (["bash", "shell scripting"], "language"),
    "PowerShell": (["powershell", "powershell scripting"], "language"),
    "SQL": (["sql", "ansi sql"], "language"),
    "PL/SQL": (["pl/sql", "plsql"], "language"),
    "T-SQL": (["t-sql", "tsql", "transact sql"], "language"),
    "Solidity": (["solidity"], "language"),
    "Lua": (["lua"], "language"),
    "Groovy": (["groovy"], "language"),
    "COBOL": (["cobol"], "language"),
    "Fortran": (["fortran"], "language"),
    "SAS": (["sas programming", "sas"], "language"),
    "Assembly": (["assembly language", "assembly"], "language"),

    # Frontend
    "React": (["react", "react.js", "reactjs", "react js"], "frontend"),
    "React Native": (["react native", "react-native"], "frontend"),
    "Next.js": (["next.js", "nextjs", "next js"], "frontend"),
    "Angular": (["angular", "angularjs", "angular.js"], "frontend"),
    "Vue.js": (["vue.js", "vuejs", "vue"], "frontend"),
    "Svelte": (["svelte", "sveltekit"], "frontend"),
    "HTML": (["html", "html5"], "frontend"),
    "CSS": (["css", "css3"], "frontend"),
    "Sass": (["sass", "scss"], "frontend"),
    "Tailwind CSS": (["tailwind css", "tailwind", "tailwindcss"], "frontend"),
    "Bootstrap": (["bootstrap"], "frontend"),
    "jQuery": (["jquery", "j query"], "frontend"),
    "Redux": (["redux", "redux toolkit"], "frontend"),
    "MobX": (["mobx"], "frontend"),
    "Webpack": (["webpack"], "frontend"),
    "Vite": (["vite"], "frontend"),
    "Babel": (["babel"], "frontend"),
    "Storybook": (["storybook"], "frontend"),
    "Material UI": (["material ui", "mui"], "frontend"),
    "Chakra UI": (["chakra ui"], "frontend"),
    "WebGL": (["webgl"], "frontend"),
    "Three.js": (["three.js", "threejs"], "frontend"),
    "D3.js": (["d3.js", "d3js", "d3"], "frontend"),
    "Electron": (["electron.js", "electronjs", "electron"], "frontend"),
    "Flutter": (["flutter"], "frontend"),
    "SwiftUI": (["swiftui"], "frontend"),
    "Jetpack Compose": (["jetpack compose"], "frontend"),
    "Xamarin": (["xamarin"], "frontend"),
    "Ionic": (["ionic"], "frontend"),
    "Cordova": (["cordova", "phonegap"], "frontend"),
    "Expo": (["expo"], "frontend"),

    # Backend / frameworks
    "Spring Boot": (["spring boot", "springboot"], "backend"),
    "Spring": (["spring", "spring framework"], "backend"),
    "Django": (["django"], "backend"),
    "Django REST Framework": (["django rest framework", "django rest", "drf"], "backend"),
    "Flask": (["flask"], "backend"),
    "FastAPI": (["fastapi", "fast api"], "backend"),
    "Express": (["express.js", "expressjs", "express"], "backend"),
    "NestJS": (["nest.js", "nestjs", "nest js"], "backend"),
    "Ruby on Rails": (["ruby on rails", "rails", "ror"], "backend"),
    "Laravel": (["laravel"], "backend"),
    "Symfony": (["symfony"], "backend"),
    "ASP.NET": (["asp.net", "aspnet", "asp net"], "backend"),
    ".NET": ([".net", "dotnet", "dot net"], "backend"),
    "Hibernate": (["hibernate"], "backend"),
    "JPA": (["jpa", "java persistence api"], "backend"),
    "Node.js": (["node.js", "nodejs", "node js"], "backend"),
    "Deno": (["deno"], "backend"),
    "GraphQL": (["graphql"], "backend"),
    "REST": (["rest", "restful", "rest api", "rest apis"], "backend"),
    "gRPC": (["grpc"], "backend"),
    "Microservices": (["microservices", "micro services"], "backend"),
    "Kafka": (["kafka", "apache kafka"], "backend"),
    "RabbitMQ": (["rabbitmq", "rabbit mq"], "backend"),
    "ActiveMQ": (["activemq", "active mq"], "backend"),
    "Celery": (["celery"], "backend"),
    "OAuth": (["oauth", "oauth2", "oauth 2"], "backend"),
    "JWT": (["jwt", "json web token"], "backend"),
    "WebSockets": (["websocket", "websockets", "web sockets"], "backend"),
    "Serverless": (["serverless"], "backend"),
    "AWS Lambda": (["aws lambda", "lambda functions"], "cloud"),
    "API Design": (["api design", "api development"], "backend"),
    "System Design": (["system design", "distributed systems"], "backend"),
    "Object-Oriented Programming": (["object-oriented programming", "object oriented programming", "oop"], "backend"),
    "Functional Programming": (["functional programming"], "backend"),
    "Data Structures": (["data structures"], "backend"),
    "Algorithms": (["algorithms", "algorithm design"], "backend"),

    # Databases
    "PostgreSQL": (["postgresql", "postgres", "psql"], "database"),
    "MySQL": (["mysql"], "database"),
    "MariaDB": (["mariadb"], "database"),
    "MongoDB": (["mongodb", "mongo db", "mongo"], "database"),
    "Redis": (["redis"], "database"),
    "Elasticsearch": (["elasticsearch", "elastic search", "elastic"], "database"),
    "Cassandra": (["cassandra"], "database"),
    "DynamoDB": (["dynamodb", "dynamo db"], "database"),
    "SQLite": (["sqlite"], "database"),
    "Oracle": (["oracle database", "oracle db", "oracle"], "database"),
    "SQL Server": (["sql server", "mssql", "microsoft sql server"], "database"),
    "Snowflake": (["snowflake"], "database"),
    "BigQuery": (["bigquery", "big query"], "database"),
    "Redshift": (["redshift", "amazon redshift"], "database"),
    "Databricks": (["databricks"], "database"),
    "Hive": (["apache hive", "hive"], "database"),
    "HBase": (["hbase"], "database"),
    "Neo4j": (["neo4j"], "database"),
    "CouchDB": (["couchdb"], "database"),
    "Firebase": (["firebase", "firestore"], "database"),
    "Supabase": (["supabase"], "database"),
    "ClickHouse": (["clickhouse"], "database"),
    "Teradata": (["teradata"], "database"),
    "DB2": (["db2", "ibm db2"], "database"),
    "Memcached": (["memcached"], "database"),
    "Pinecone": (["pinecone"], "database"),
    "Milvus": (["milvus"], "database"),
    "Weaviate": (["weaviate"], "database"),
    "ChromaDB": (["chromadb", "chroma db", "chroma"], "database"),
    "FAISS": (["faiss"], "database"),

    # Cloud / DevOps
    "AWS": (["aws", "amazon web services"], "cloud"),
    "AWS EC2": (["aws ec2", "amazon ec2", "ec2"], "cloud"),
    "AWS S3": (["aws s3", "amazon s3", "s3 bucket", "s3"], "cloud"),
    "Azure": (["azure", "microsoft azure"], "cloud"),
    "GCP": (["gcp", "google cloud", "google cloud platform"], "cloud"),
    "Docker": (["docker", "dockerfile"], "devops"),
    "Kubernetes": (["kubernetes", "k8s"], "devops"),
    "OpenShift": (["openshift"], "devops"),
    "Terraform": (["terraform"], "devops"),
    "Ansible": (["ansible"], "devops"),
    "Jenkins": (["jenkins"], "devops"),
    "GitLab CI": (["gitlab ci", "gitlab ci/cd"], "devops"),
    "GitHub Actions": (["github actions"], "devops"),
    "CircleCI": (["circleci", "circle ci"], "devops"),
    "ArgoCD": (["argocd", "argo cd"], "devops"),
    "Helm": (["helm"], "devops"),
    "Prometheus": (["prometheus"], "devops"),
    "Grafana": (["grafana"], "devops"),
    "Datadog": (["datadog", "data dog"], "devops"),
    "Splunk": (["splunk"], "devops"),
    "ELK Stack": (["elk stack", "elk", "elastic stack"], "devops"),
    "Nginx": (["nginx"], "devops"),
    "Apache": (["apache http server", "apache server", "apache"], "devops"),
    "Linux": (["linux", "ubuntu", "centos", "debian", "red hat"], "devops"),
    "Unix": (["unix"], "devops"),
    "Windows Server": (["windows server"], "devops"),
    "VMware": (["vmware"], "devops"),
    "CloudFormation": (["cloudformation", "cloud formation"], "devops"),
    "Pulumi": (["pulumi"], "devops"),
    "Istio": (["istio"], "devops"),
    "Consul": (["consul"], "devops"),
    "Vault": (["hashicorp vault", "vault"], "devops"),
    "Heroku": (["heroku"], "devops"),
    "Vercel": (["vercel"], "devops"),
    "Netlify": (["netlify"], "devops"),
    "Cloudflare": (["cloudflare"], "devops"),
    "CI/CD": (["ci/cd", "cicd", "continuous integration", "continuous delivery", "continuous deployment"], "devops"),
    "Maven": (["maven", "apache maven"], "tool"),
    "Gradle": (["gradle"], "tool"),
    "Git": (["git"], "tool"),
    "GitHub": (["github"], "tool"),
    "GitLab": (["gitlab"], "tool"),
    "Bitbucket": (["bitbucket"], "tool"),

    # Data / ML / AI
    "Machine Learning": (["machine learning", "ml"], "data"),
    "Deep Learning": (["deep learning"], "data"),
    "TensorFlow": (["tensorflow", "tensor flow"], "data"),
    "PyTorch": (["pytorch", "py torch"], "data"),
    "Keras": (["keras"], "data"),
    "scikit-learn": (["scikit-learn", "scikit learn", "sklearn"], "data"),
    "Pandas": (["pandas"], "data"),
    "NumPy": (["numpy", "num py"], "data"),
    "SciPy": (["scipy"], "data"),
    "Matplotlib": (["matplotlib"], "data"),
    "Seaborn": (["seaborn"], "data"),
    "Plotly": (["plotly"], "data"),
    "OpenCV": (["opencv", "open cv"], "data"),
    "NLP": (["nlp", "natural language processing"], "data"),
    "Computer Vision": (["computer vision"], "data"),
    "LLM": (["llm", "large language models", "large language model"], "data"),
    "Generative AI": (["generative ai", "genai", "gen ai"], "data"),
    "LangChain": (["langchain", "lang chain"], "data"),
    "LlamaIndex": (["llamaindex", "llama index"], "data"),
    "Hugging Face": (["hugging face", "huggingface"], "data"),
    "Transformers": (["transformers"], "data"),
    "XGBoost": (["xgboost", "xgb"], "data"),
    "LightGBM": (["lightgbm"], "data"),
    "CatBoost": (["catboost"], "data"),
    "Spark": (["apache spark", "spark"], "data"),
    "PySpark": (["pyspark"], "data"),
    "Hadoop": (["hadoop"], "data"),
    "Airflow": (["airflow", "apache airflow"], "data"),
    "dbt": (["dbt"], "data"),
    "ETL": (["etl", "extract transform load"], "data"),
    "Data Warehousing": (["data warehousing", "data warehouse"], "data"),
    "Data Modeling": (["data modeling", "data modelling"], "data"),
    "Data Mining": (["data mining"], "data"),
    "Statistics": (["statistics", "statistical analysis"], "data"),
    "A/B Testing": (["a/b testing", "ab testing", "split testing"], "data"),
    "MLOps": (["mlops", "ml ops"], "data"),
    "Kubeflow": (["kubeflow"], "data"),
    "MLflow": (["mlflow"], "data"),
    "Recommendation Systems": (["recommendation systems", "recommender systems"], "data"),
    "Time Series": (["time series"], "data"),
    "Reinforcement Learning": (["reinforcement learning"], "data"),
    "Prompt Engineering": (["prompt engineering"], "data"),
    "RAG": (["rag", "retrieval augmented generation"], "data"),

    # BI / analytics / enterprise tools
    "Power BI": (["power bi", "powerbi"], "analytics"),
    "Tableau": (["tableau"], "analytics"),
    "Looker": (["looker", "looker studio"], "analytics"),
    "QlikView": (["qlikview", "qlik view"], "analytics"),
    "Qlik Sense": (["qlik sense"], "analytics"),
    "Google Analytics": (["google analytics", "ga4"], "analytics"),
    "Google Tag Manager": (["google tag manager", "gtm"], "analytics"),
    "Excel": (["excel", "ms excel", "microsoft excel", "advanced excel"], "analytics"),
    "Alteryx": (["alteryx"], "analytics"),
    "SSIS": (["ssis"], "analytics"),
    "SSRS": (["ssrs"], "analytics"),
    "SAP": (["sap", "sap erp"], "enterprise"),
    "Oracle Fusion": (["oracle fusion"], "enterprise"),
    "Salesforce": (["salesforce", "salesforce crm", "sales cloud"], "enterprise"),
    "HubSpot": (["hubspot"], "enterprise"),
    "Zoho CRM": (["zoho crm", "zoho"], "enterprise"),
    "ServiceNow": (["servicenow", "service now"], "enterprise"),
    "Workday": (["workday"], "enterprise"),
    "Microsoft Dynamics": (["microsoft dynamics", "dynamics 365", "ms dynamics"], "enterprise"),
    "Odoo": (["odoo"], "enterprise"),

    # Testing
    "Selenium": (["selenium", "selenium webdriver"], "testing"),
    "Cypress": (["cypress"], "testing"),
    "Playwright": (["playwright"], "testing"),
    "Jest": (["jest"], "testing"),
    "Mocha": (["mocha"], "testing"),
    "Chai": (["chai"], "testing"),
    "Pytest": (["pytest", "py.test"], "testing"),
    "JUnit": (["junit"], "testing"),
    "TestNG": (["testng"], "testing"),
    "Mockito": (["mockito"], "testing"),
    "Postman": (["postman"], "testing"),
    "JMeter": (["jmeter", "apache jmeter"], "testing"),
    "LoadRunner": (["loadrunner"], "testing"),
    "Cucumber": (["cucumber", "bdd"], "testing"),
    "Appium": (["appium"], "testing"),
    "TestRail": (["testrail"], "testing"),
    "Unit Testing": (["unit testing", "unit tests"], "testing"),
    "Integration Testing": (["integration testing", "integration tests"], "testing"),
    "TDD": (["tdd", "test driven development"], "testing"),

    # Mobile
    "Android": (["android", "android development"], "mobile"),
    "iOS": (["ios", "ios development"], "mobile"),

    # Design
    "Figma": (["figma"], "design"),
    "Sketch": (["sketch"], "design"),
    "Adobe XD": (["adobe xd", "adobexd"], "design"),
    "Photoshop": (["photoshop", "adobe photoshop"], "design"),
    "Illustrator": (["illustrator", "adobe illustrator"], "design"),
    "InDesign": (["indesign", "adobe indesign"], "design"),
    "Canva": (["canva"], "design"),
    "UI/UX": (["ui/ux", "ui ux", "user experience", "user interface design"], "design"),
    "Wireframing": (["wireframing", "wireframes"], "design"),
    "Prototyping": (["prototyping", "prototypes"], "design"),
    "Accessibility": (["accessibility", "wcag", "a11y"], "design"),

    # Security / networking
    "Cybersecurity": (["cybersecurity", "cyber security", "information security"], "security"),
    "Penetration Testing": (["penetration testing", "pen testing", "pentesting"], "security"),
    "Ethical Hacking": (["ethical hacking"], "security"),
    "OWASP": (["owasp"], "security"),
    "SIEM": (["siem"], "security"),
    "Nessus": (["nessus"], "security"),
    "Burp Suite": (["burp suite", "burpsuite"], "security"),
    "Metasploit": (["metasploit"], "security"),
    "Wireshark": (["wireshark"], "security"),
    "Kali Linux": (["kali linux", "kali"], "security"),
    "Cryptography": (["cryptography"], "security"),
    "IAM": (["iam", "identity and access management"], "security"),
    "SAST": (["sast"], "security"),
    "DAST": (["dast"], "security"),
    "TCP/IP": (["tcp/ip", "tcp ip"], "networking"),
    "DNS": (["dns"], "networking"),
    "DHCP": (["dhcp"], "networking"),
    "VPN": (["vpn"], "networking"),
    "Firewall": (["firewall"], "networking"),
    "Cisco": (["cisco"], "networking"),
    "CCNA": (["ccna"], "networking"),
    "Load Balancing": (["load balancing", "load balancer"], "networking"),

    # Collaboration / process
    "Jira": (["jira"], "process"),
    "Confluence": (["confluence"], "process"),
    "Notion": (["notion"], "process"),
    "Trello": (["trello"], "process"),
    "Asana": (["asana"], "process"),
    "Agile": (["agile", "agile methodology"], "process"),
    "Scrum": (["scrum"], "process"),
    "Kanban": (["kanban"], "process"),
    "DevOps": (["devops"], "process"),
    "Project Management": (["project management"], "process"),
    "Product Management": (["product management"], "process"),
    "Business Analysis": (["business analysis", "business analyst"], "process"),
    "Stakeholder Management": (["stakeholder management"], "process"),
    "Technical Writing": (["technical writing"], "process"),
    "Problem Solving": (["problem solving"], "soft"),
    "Communication": (["communication skills", "communication"], "soft"),
    "Leadership": (["leadership"], "soft"),
}

# Preserve the legacy catalogue order so existing callers and tests that use
# `find_skills(text, SKILLS)` keep deterministic ordering. New skills append in
# taxonomy order.
_LEGACY_SKILL_ORDER = [
    "Java", "Python", "React", "Spring Boot", "SQL", "AWS",
    "JavaScript", "TypeScript", "Node.js", "Express", "NestJS", "Next.js",
    "Angular", "Vue.js", "HTML", "CSS", "Django", "Flask", "FastAPI",
    "Go", "Rust", "C++", "C#", ".NET", "Kotlin", "Swift", "PHP", "Ruby on Rails",
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch",
    "Docker", "Kubernetes", "Terraform", "Jenkins", "Git", "Linux",
    "Kafka", "RabbitMQ", "GraphQL", "REST", "Microservices",
    "Machine Learning", "TensorFlow", "PyTorch", "Pandas", "NumPy",
    "Selenium", "Cypress", "JUnit", "Mockito", "Hibernate", "JPA", "Maven", "Gradle",
    "Azure", "GCP", "Snowflake", "Airflow", "Spark", "Figma",
]
_LEGACY_LANGUAGE_ORDER = [
    "Java", "Python", "JavaScript", "TypeScript", "Go", "Rust", "C++",
    "C#", "Kotlin", "Swift", "PHP", "Ruby", "Scala", "R",
]

SKILLS: list[str] = list(dict.fromkeys(_LEGACY_SKILL_ORDER + list(_TAXONOMY)))
LANGUAGES: list[str] = list(dict.fromkeys(_LEGACY_LANGUAGE_ORDER + [
    canonical for canonical, (_, category) in _TAXONOMY.items() if category == "language"
]))
ALIASES: dict[str, list[str]] = {
    canonical: list(dict.fromkeys([alias for alias in aliases if alias.casefold() != canonical.casefold()]))
    for canonical, (aliases, _) in _TAXONOMY.items()
}

_LANGUAGE_CANONICAL = frozenset(LANGUAGES)
_LIST_LANGUAGE_TOKENS = frozenset({
    "python", "java", "javascript", "typescript", "go", "golang", "c", "c++", "c#",
    "r", "rust", "kotlin", "swift", "php", "ruby", "scala", "sql", "react",
    "angular", "vue", "node", "node.js", "django", "flask", "aws", "docker",
    "kubernetes", "spring", "rails", "laravel", "html", "css",
})
_LIST_TOKEN_RE = re.compile(r"(?<![\w+#])[A-Za-z][A-Za-z0-9+#.]*(?![\w+#])")

# Requirement resolution is punctuation/space tolerant and symmetric.
def _alias_key(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().casefold())


_ALIAS_INDEX: dict[str, str] = {}
for _canonical, (_aliases, _category) in _TAXONOMY.items():
    for _alias in [_canonical, *_aliases]:
        _ALIAS_INDEX.setdefault(_alias_key(_alias), _canonical)
        _ALIAS_INDEX.setdefault(_alias_key(_alias.replace(".", " ")), _canonical)
        _ALIAS_INDEX.setdefault(_alias_key(_alias.replace("-", " ")), _canonical)

_AMBIGUOUS = {
    "C": "one_letter",
    "R": "one_letter",
    "Go": "common_word",
    "Spring": "common_word",
    "Express": "common_word",
    "Spark": "common_word",
    "REST": "acronym",
    "Excel": "common_word",
    "JavaScript": "short_alias",
    "TypeScript": "short_alias",
    "Machine Learning": "short_alias",
    "LLM": "acronym",
    "Generative AI": "acronym",
    "AI": "acronym",
}

_SECTION_HEADERS = {
    "skills": {"skills", "technical skills", "key skills", "core skills", "skill set",
        "technologies", "technical proficiency", "tech stack", "expertise", "competencies",
        "programming languages", "tools", "tools and technologies"},
    "experience": {"experience", "work experience", "professional experience", "employment history",
        "work history", "career history", "employment", "career", "professional background"},
    "projects": {"projects", "personal projects", "project experience", "selected projects"},
    "certifications": {"certifications", "certificates", "licenses", "training"},
    "education": {"education", "educational qualifications", "academic qualifications",
        "academic background", "educational background", "qualifications"},
    "summary": {"summary", "professional summary", "profile summary", "career summary",
        "objective", "career objective", "profile", "about me"},
    "contact": {"contact", "contact details", "personal information", "personal details"},
}
_HEADER_TO_SECTION = {header: name for name, headers in _SECTION_HEADERS.items() for header in headers}
_HEADER_RE = re.compile(r"^[\s#*\-•●▪◦]+")
_TRAIL_RE = re.compile(r"[\s:|\-–—]+$")

_EMAIL_RE = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)


def canonical_skill(value: str) -> str:
    """Resolve a known alias to its canonical name; unknown values pass through."""
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    return _ALIAS_INDEX.get(_alias_key(cleaned)) or _ALIAS_INDEX.get(
        _alias_key(re.sub(r"[\s._/-]+", " ", cleaned))) or cleaned


def resolve_skill(value: str) -> str | None:
    """Canonical name for a known skill/alias, else None."""
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    return _ALIAS_INDEX.get(_alias_key(cleaned)) or _ALIAS_INDEX.get(
        _alias_key(re.sub(r"[\s._/-]+", " ", cleaned)))


def skill_variants(skill: str) -> list[str]:
    """All known spellings for a canonical name or alias."""
    canonical = resolve_skill(skill) or (skill or "").strip()
    entry = _TAXONOMY.get(canonical)
    if not entry:
        return [canonical] if canonical else []
    return list(dict.fromkeys([canonical, *entry[0]]))


def mask_contacts(text: str) -> str:
    """Replace email/URL spans before matching so contacts cannot create skills."""
    text = text or ""
    text = _EMAIL_RE.sub(lambda m: " " * len(m.group(0)), text)
    return _URL_RE.sub(lambda m: " " * len(m.group(0)), text)


def _section_spans(text: str) -> list[tuple[int, int, str]]:
    spans: list[tuple[int, int, str]] = []
    offset = 0
    current = "other"
    for line in text.splitlines(keepends=True):
        raw = line.rstrip("\r\n")
        heading = _TRAIL_RE.sub("", _HEADER_RE.sub("", raw)).strip().casefold()
        colon = re.match(r"^([A-Za-z][A-Za-z /&+-]{1,40})\s*:\s*(.*)$", raw.strip())
        if colon:
            label = _TRAIL_RE.sub("", colon.group(1)).strip().casefold()
            if label in _HEADER_TO_SECTION:
                current = _HEADER_TO_SECTION[label]
                value_start = offset + raw.find(colon.group(2)) if colon.group(2) else offset
                spans.append((offset, value_start + len(colon.group(2)), current))
                offset += len(line)
                continue
        if heading in _HEADER_TO_SECTION:
            current = _HEADER_TO_SECTION[heading]
        spans.append((offset, offset + len(line), current))
        offset += len(line)
    if not spans and text:
        spans.append((0, len(text), "other"))
    return spans


def _section_at(spans: list[tuple[int, int, str]], position: int) -> str:
    if not spans:
        return "other"
    starts = [span[0] for span in spans]
    index = bisect.bisect_right(starts, position) - 1
    if index < 0:
        return "other"
    return spans[index][2]


def _line_bounds(text: str, position: int) -> tuple[int, int]:
    start = text.rfind("\n", 0, position) + 1
    end = text.find("\n", position)
    return start, len(text) if end < 0 else end


def _looks_like_skill_list(line: str) -> bool:
    if not re.search(r"[,/;|]", line):
        return False
    tokens = {token.casefold().rstrip(".") for token in _LIST_TOKEN_RE.findall(line)}
    return len(tokens & _LIST_LANGUAGE_TOKENS) >= 2


@lru_cache(maxsize=2048)
def _pattern(alias: str, *, ignore_case: bool = True) -> re.Pattern:
    parts = [re.escape(part) for part in alias.split()]
    body = r"[\s._-]*".join(parts)
    flags = re.IGNORECASE if ignore_case else 0
    return re.compile(r"(?<![\w])" + body + r"(?![\w+#])", flags)


def _context_ok(canonical: str, alias: str, matched: str, text: str, start: int, end: int,
                section: str, spans: list[tuple[int, int, str]]) -> bool:
    line_start, line_end = _line_bounds(text, start)
    line = text[line_start:line_end]
    skill_section = section in {"skills", "projects", "certifications"}
    list_context = _looks_like_skill_list(line)
    after = text[end:end + 40].lstrip()
    before = text[max(0, start - 40):start].casefold()

    if canonical == "C":
        if matched != "C":
            return False
        if re.match(r"(?:\+{1,2}|#)", text[end:end + 2]):
            return False
        if re.match(r"\s*[-–—]\s*(?:level|suite|corporate|executive|officer)", after, re.I):
            return False
        return skill_section or list_context or bool(re.search(r"\bC\s+(?:programming|language|developer|code)\b", text, re.I))
    if canonical == "R":
        if matched != "R":
            return False
        if re.match(r"\s*&", text[end:end + 4]):
            return False
        return skill_section or list_context or bool(re.search(r"\bR\s+(?:programming|language|developer|statistics)\b", text, re.I))
    if canonical == "Go":
        if matched.casefold() == "go" and not matched[0].isupper():
            return False
        if re.match(r"(?:to|the|a|an|for|through|beyond|above|away|back|on|off|out|up|down|home|forward)\b", after, re.I):
            return False
        return (skill_section or list_context
            or bool(re.match(r"(?:developer|engineer|programming|language|services|microservices|code|backend|api)\b", after, re.I))
            or bool(re.search(r"(?:experience with|proficient in|skills?|using|worked with)\s*$", before, re.I)))
    if canonical in {"JavaScript", "TypeScript"} and alias.casefold() in {"js", "ts"}:
        if start > 0 and text[start - 1] in "._":
            return False
        if not matched.isupper():
            return skill_section or list_context
        return True
    if canonical == "Machine Learning" and alias.casefold() == "ml":
        return matched.isupper() or skill_section or list_context
    if canonical in {"LLM", "Generative AI"} or alias.casefold() in {"ai", "ml", "nlp", "rag"}:
        return matched.isupper() or skill_section or list_context
    if canonical == "Spring":
        if re.match(r"(?:20\d{2}|semester|summer|winter|autumn|fall)\b", after, re.I):
            return False
        return matched[0].isupper() or skill_section or list_context
    if canonical == "Express":
        if alias.casefold() == "express" and not matched[0].isupper():
            return skill_section or list_context
        return True
    if canonical == "Spark":
        return matched[0].isupper() or skill_section or list_context
    if canonical == "REST":
        if alias.casefold() == "rest" and matched != "REST":
            return False
        return True
    if canonical == "Excel":
        if re.match(r"(?:at|in|as)\b", after, re.I):
            return False
        if matched[0].isupper() or skill_section or list_context:
            return True
        return bool(re.search(r"(?:advanced|ms|microsoft)\s+$", before, re.I))
    return True


def _is_negated(text: str, start: int, end: int) -> bool:
    clause = max(text.rfind(part, 0, start) for part in (".", ";", "\n")) + 1
    for word in ("but", "however", "although", "whereas"):
        index = text.rfind(word, clause, start)
        if index >= 0 and text[index - 1:index].isspace() and text[index + len(word):index + len(word) + 1].isspace():
            clause = index + len(word)
    prefix = text[clause:start]
    if re.search(r"\b(?:no|not|never|without|zero|nil|lack(?:s|ing)?|don'?t|doesn'?t|didn'?t|isn'?t|wasn'?t|aren'?t|won'?t)\b"
                 r"(?!\s+only|\s*-\s*code\b|\s+(?:downtime|interruptions?|delays?|outages?)\b)", prefix, re.IGNORECASE):
        return True
    suffix = text[end:end + 50]
    if re.search(r"^\s*(?:is\s+|are\s+|was\s+|were\s+)?(?:not|never)\s+"
                 r"(?:used|using|worked|required|needed|proficient|familiar)", suffix, re.IGNORECASE):
        return True
    return bool(re.search(r"\bnot\s+(?:a|an)\s+$", prefix, re.IGNORECASE))


def _best_evidence(matches: list[dict]) -> dict:
    rank = {"skills": 5, "certifications": 4, "projects": 3, "experience": 2, "summary": 1, "other": 0, "education": 0, "contact": -1}
    return max(matches, key=lambda item: (rank.get(item["section"], 0), item["confidence"], len(item["matchedText"])))


def _skill_matches(text: str, canonical: str, spans: list[tuple[int, int, str]]) -> list[dict]:
    entry = _TAXONOMY.get(canonical)
    if not entry:
        return []
    variants = sorted({alias.casefold(): alias for alias in reversed([canonical, *entry[0]])}.values(), key=len, reverse=True)
    matches: list[dict] = []
    seen_positions: set[int] = set()
    for alias in variants:
        ambiguous = canonical in _AMBIGUOUS
        if canonical in {"C", "R"}:
            pattern = _pattern(alias, ignore_case=False)
        else:
            pattern = _pattern(alias)
        for match in pattern.finditer(text):
            start, end = match.span()
            if start in seen_positions:
                continue
            section = _section_at(spans, start)
            if _is_negated(text, start, end):
                continue
            if not _context_ok(canonical, alias, match.group(0), text, start, end, section, spans):
                continue
            line_start, line_end = _line_bounds(text, start)
            excerpt = " ".join(text[line_start:line_end].split())[:280]
            confidence = 1.0 if section in {"skills", "certifications", "projects"} else 0.9 if section == "experience" else 0.78
            if ambiguous and alias.casefold() in {"c", "r"}:
                confidence = min(confidence, 0.82)
            seen_positions.add(start)
            matches.append({"skill": canonical, "matchedText": match.group(0)[:120], "excerpt": excerpt,
                "section": section, "page": text.count("\f", 0, start) + 1,
                "method": "canonical" if alias.casefold() == canonical.casefold() else "alias",
                "confidence": round(confidence, 2), "occurrences": 1})
        if len(matches) >= 40:
            break
    if not matches:
        return []
    best = _best_evidence(matches)
    best["occurrences"] = len(matches)
    return [best]


def extract_skill_evidence(text: str, catalogue: list[str] | None = None) -> list[dict]:
    """Canonical skills with the best supporting excerpt, in catalogue order."""
    safe = mask_contacts(text or "")
    spans = _section_spans(safe)
    chosen = catalogue or SKILLS
    output: list[dict] = []
    seen: set[str] = set()
    for canonical in chosen:
        canonical = resolve_skill(canonical) or canonical
        if canonical in seen:
            continue
        evidence = _skill_matches(safe, canonical, spans)
        if evidence:
            seen.add(canonical)
            output.append(evidence[0])
    return output


def skills_in_text(text: str) -> list[str]:
    """All canonical taxonomy skills present, in catalogue order."""
    return [item["skill"] for item in extract_skill_evidence(text)]


def skill_hit(text: str, skill: str) -> bool:
    """True when `skill` or a known alias appears as a real, non-negated skill.

    Unknown labels (e.g. degree terms used by the ATS) fall back to a tolerant
    literal phrase match so existing callers keep working.
    """
    canonical = resolve_skill(skill)
    if canonical is None:
        cleaned = (skill or "").strip()
        if not cleaned:
            return False
        parts = [re.escape(part) for part in re.split(r"[\s._/-]+", cleaned) if part]
        if not parts:
            return False
        pattern = re.compile(r"(?<!\w)" + r"[\s._/-]*".join(parts) + r"(?!\w)", re.IGNORECASE)
        return any(not _is_negated(text or "", m.start(), m.end()) for m in pattern.finditer(text or ""))
    safe = mask_contacts(text or "")
    return bool(_skill_matches(safe, canonical, _section_spans(safe)))


def find_skills(text: str, catalogue: list[str]) -> list[str]:
    """Catalogue skills present in text, in catalogue order, no duplicates."""
    safe = mask_contacts(text or "")
    spans = _section_spans(safe)
    output: list[str] = []
    seen: set[str] = set()
    for skill in catalogue:
        canonical = resolve_skill(skill)
        if canonical is None:
            if skill_hit(safe, skill) and skill.strip() not in seen:
                seen.add(skill.strip())
                output.append(skill.strip())
            continue
        if canonical in seen:
            continue
        if _skill_matches(safe, canonical, spans):
            seen.add(canonical)
            output.append(canonical)
    return output
