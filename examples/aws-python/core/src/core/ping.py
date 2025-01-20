import requests


def ping():
    return requests.get("https://api.github.com").status_code
