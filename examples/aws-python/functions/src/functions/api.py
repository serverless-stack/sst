from sst import Resource
from functions.shared import foo
from core.db import get_user
from core.ping import ping


def handler(event, context):
    print("Function invoked from Python")

    # Share code within the same workspace package
    print(foo())

    # Share code between workspace packages
    res = ping()
    print(get_user("1234"))
    print("Ping result:", res)

    # Use the SST SDK to access resources
    print(f"Resource.MyLinkableValue.foo: {Resource.MyLinkableValue.foo}")

    return {
        "statusCode": 200,
        "body": f"{Resource.MyLinkableValue.foo} from Python!",
    }
