from core.ping import ping
from sst import Resource


def handler(event, context):
    response_code = ping()
    print(f"Response code: {response_code}")

    return {
        "statusCode": 200,
        "body": f"Hello, World! - Linkable value: {Resource.MyLinkableValue.foo}",
    }
