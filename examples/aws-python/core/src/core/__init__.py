from core.db import get_user


def hello() -> str:
    return "Hello from core!"


__all__ = ["get_user", "hello"]
