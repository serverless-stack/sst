import os
import json
import base64
from typing import Dict, Any
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

raw: Dict[str, Any] = {}

# Load links from environment
if "$SST_LINKS" in globals():
    raw.update(globals()["$SST_LINKS"])

# Load environment variables
environment = os.environ
for key, value in environment.items():
    if key.startswith("SST_RESOURCE_") and value:
        raw[key[len("SST_RESOURCE_") :]] = json.loads(value)

# Check if SST_KEY_FILE and SST_KEY are in environment variables
# and SST_KEY_FILE_DATA is not already set in globals()
if (
    "SST_KEY_FILE" in os.environ
    and "SST_KEY" in os.environ
    and "SST_KEY_FILE_DATA" not in globals()
):
    # Decode the base64-encoded key from the environment variable
    key = base64.b64decode(os.environ["SST_KEY"])

    # Read the encrypted data from the file specified in the environment variable
    with open(os.environ["SST_KEY_FILE"], "rb") as f:
        encryptedData = f.read()

    # Create a nonce of 12 zero bytes (as per your original code)
    nonce = bytes(12)

    # Extract the authentication tag and the actual ciphertext
    authTag = encryptedData[-16:]
    actualCiphertext = encryptedData[:-16]

    # Concatenate the ciphertext and authTag as required by AESGCM
    ciphertext_with_tag = actualCiphertext + authTag

    # Create an AESGCM cipher object with the key
    aesgcm = AESGCM(key)

    # Decrypt the ciphertext
    plaintext = aesgcm.decrypt(nonce, ciphertext_with_tag, associated_data=None)

    # Parse the decrypted plaintext as JSON
    decryptedData = json.loads(plaintext.decode("utf-8"))

    # Update the 'raw' dictionary with the decrypted data
    raw.update(decryptedData)

    # **Set SST_KEY_FILE_DATA to the decrypted data**
    globals()["SST_KEY_FILE_DATA"] = decryptedData


if "SST_KEY_FILE_DATA" in globals():
    raw.update(globals()["SST_KEY_FILE_DATA"])


class AttrDict:
    def __init__(self, data):
        for key, value in data.items():
            self.__dict__[key] = self._wrap(value)

    def _wrap(self, value):
        if isinstance(value, dict):
            return AttrDict(value)
        elif isinstance(value, list):
            return [self._wrap(item) for item in value]
        else:
            return value

    def __getattr__(self, item):
        if item in self.__dict__:
            return self.__dict__[item]
        raise AttributeError(f"'AttrDict' object has no attribute '{item}'")

    def __setattr__(self, key, value):
        self.__dict__[key] = value


raw = AttrDict(raw)


class ResourceProxy:
    def __getattr__(self, prop):
        if hasattr(raw, prop):
            return getattr(raw, prop)

        if "SST_RESOURCE_App" not in os.environ:
            raise Exception(
                "It does not look like SST links are active. If this is in local development and you are not starting this process through the multiplexer, wrap your command with `sst dev -- <command>`"
            )

        msg = f'"{prop}" is not linked in your sst.config.ts'
        if "AWS_LAMBDA_FUNCTION_NAME" in os.environ:
            msg += f' to {os.environ["AWS_LAMBDA_FUNCTION_NAME"]}'
        raise Exception(msg)


Resource = ResourceProxy()
