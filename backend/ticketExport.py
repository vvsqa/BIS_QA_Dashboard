import argparse
import json
import sys

import requests


def fetch_ticket_export(base_url, api_key, limit=0, offset=0, timeout=60):
    params = {}
    if limit and limit > 0:
        params["limit"] = limit
    if offset and offset > 0:
        params["offset"] = offset

    headers = {
        "authID": api_key
    }

    response = requests.get(base_url, headers=headers, params=params, timeout=timeout)
    response.raise_for_status()
    return response.json()


def main():
    parser = argparse.ArgumentParser(description="Call PM ticket export API.")
    parser.add_argument("--url", required=True, help="Full API URL, e.g. https://pre.bissafety.app/bisapi/v01/pm/ticket-export")
    parser.add_argument("--key", required=True, help="API key for authID header")
    parser.add_argument("--limit", type=int, default=0, help="Max rows to return")
    parser.add_argument("--offset", type=int, default=0, help="Offset for pagination")
    parser.add_argument("--timeout", type=int, default=60, help="Request timeout in seconds")
    args = parser.parse_args()

    try:
        data = fetch_ticket_export(
            base_url=args.url,
            api_key=args.key,
            limit=args.limit,
            offset=args.offset,
            timeout=args.timeout
        )
        print(json.dumps(data, indent=2))
    except requests.HTTPError as exc:
        print(f"HTTP error: {exc} - {exc.response.text}", file=sys.stderr)
        sys.exit(1)
    except requests.RequestException as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()