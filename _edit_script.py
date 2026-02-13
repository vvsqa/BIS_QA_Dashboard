path = r'd:\Vishnu VS\Projects\qa-dashboard-app\frontend\src\QATaskPlanning.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
content = content.replace("import { apiFetch } from './api';", "import { apiFetch, API_BASE } from './api';")
old_line = 'const API_BASE = (process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:8000`).replace(/\\/$/, \'\');\n'
content = content.replace(old_line, "")
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
