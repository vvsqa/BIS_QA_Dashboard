import requests
from datetime import date, timedelta

BASE = 'http://127.0.0.1:8000'

# Use an employee that exists in test data
EMAIL = 'binoy.dominic@techversantinfotech.com'
PASSWORD = 'TV0154'

# Login
r = requests.post(f'{BASE}/auth/login', json={'email': EMAIL, 'password': PASSWORD})
if r.status_code != 200:
    print('Login failed:', r.status_code, r.text)
    exit(1)

token = r.json()['access_token']
headers = {'Authorization': f'Bearer {token}'}

# Pick current week
today = date.today()
week_start = today - timedelta(days=today.weekday())
week_end = week_start + timedelta(days=6)

print('Attempting to submit timesheet for week ending', week_end)
resp = requests.post(f'{BASE}/timesheet/submit', json={'week_ending': week_end.isoformat(), 'notes': 'Test submit'}, headers=headers)
print('Status code:', resp.status_code)
print('Response:', resp.text)

if resp.status_code == 400:
    print('Validation working: cannot submit when total < 36 hours')
else:
    print('Unexpected status code; check if test user has >=36 hours in the week')
