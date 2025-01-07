package resource

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
)

var resources map[string]any

func init() {
	key, err := base64.StdEncoding.DecodeString(os.Getenv("SST_KEY"))
	if err != nil {
		panic(err)
	}
	encryptedData, err := os.ReadFile(os.Getenv("SST_KEY_FILE"))
	if err != nil {
		panic(err)
	}
	nonce := make([]byte, 12)
	block, err := aes.NewCipher(key)
	if err != nil {
		panic(err)
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		panic(err)
	}

	// Split the auth tag and ciphertext
	authTagStart := len(encryptedData) - 16
	actualCiphertext := encryptedData[:authTagStart]
	authTag := encryptedData[authTagStart:]

	// In Go, we pass the auth tag as part of the ciphertext
	ciphertextWithTag := append(actualCiphertext, authTag...)

	// Decrypt
	decrypted, err := aesGCM.Open(nil, nonce, ciphertextWithTag, nil)
	if err != nil {
		panic(err)
	}

	// Parse JSON
	if err := json.Unmarshal(decrypted, &resources); err != nil {
		panic(err)
	}

	for _, item := range os.Environ() {
		pair := strings.SplitN(item, "=", 2)
		key := pair[0]
		value := pair[1]
		if strings.HasPrefix(key, "SST_RESOURCE_") {
			var result map[string]interface{}
			err := json.Unmarshal([]byte(value), &result)
			if err != nil {
				panic(err)
			}
			resources[strings.TrimPrefix(key, "SST_RESOURCE_")] = result
		}
	}
}

var ErrNotFound = errors.New("not found")

func Get(path ...string) (any, error) {
	return get(resources, path...)
}

func All() map[string]any {
	return resources
}

func get(input any, path ...string) (any, error) {
	if len(path) == 0 {
		return input, nil
	}
	casted, ok := input.(map[string]any)
	if !ok {
		return nil, ErrNotFound
	}
	next, ok := casted[path[0]]
	if !ok {
		return nil, ErrNotFound
	}
	return get(next, path[1:]...)
}
