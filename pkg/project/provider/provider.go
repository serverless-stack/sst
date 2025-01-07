package provider

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/sst/sst/v3/pkg/flag"
	"golang.org/x/exp/slog"
	"golang.org/x/sync/errgroup"
)

type Home interface {
	Bootstrap() error
	getData(key, app, stage string) (io.Reader, error)
	putData(key, app, stage string, data io.Reader) error
	removeData(key, app, stage string) error
	setPassphrase(app, stage string, passphrase string) error
	getPassphrase(app, stage string) (string, error)
}

type DevTransport struct {
	In  chan string
	Out chan string
}

type Provider interface {
	Init(app string, stage string, args map[string]interface{}) error
	Env() (map[string]string, error)
}

type DevEvent struct {
	*io.PipeReader
}

func (dt *DevTransport) Publish(input interface{}) error {
	jsonBytes, err := json.Marshal(input)
	if err != nil {
		return err
	}
	dt.Out <- string(jsonBytes)
	return nil
}

type DevSession interface {
	Cleanup() error
	Publish(json string) error
}

const SSM_NAME_BOOTSTRAP = "/sst/bootstrap"

var ErrLockExists = fmt.Errorf("Concurrent update detected, run `sst unlock --stage=<stage>` to delete lock file and retry.")
var ErrLockNotFound = fmt.Errorf("Lock not found")
var passphraseCache = map[Home]map[string]string{}

func Copy(from Home, to Home, app, stage string) error {
	reader, err := from.getData("app", app, stage)
	if err != nil {
		return err
	}
	err = to.putData("app", app, stage, reader)
	if err != nil {
		return err
	}
	reader, err = from.getData("secret", app, stage)
	if err != nil {
		return err
	}
	to.putData("secret", app, stage, reader)
	return nil
}

func Passphrase(backend Home, app, stage string) (string, error) {
	slog.Info("getting passphrase", "app", app, "stage", stage)

	cache, ok := passphraseCache[backend]
	if !ok {
		cache = map[string]string{}
		passphraseCache[backend] = cache
	}

	existingPassphrase, ok := cache[app+stage]
	if ok {
		return existingPassphrase, nil
	}

	passphrase, err := backend.getPassphrase(app, stage)
	if err != nil {
		return "", err
	}

	if passphrase == "" {
		slog.Info("passphrase not found, setting passphrase", "app", app, "stage", stage)
		passphrase = flag.SST_PASSPHRASE
		if passphrase == "" {
			bytes := make([]byte, 32)
			_, err := rand.Read(bytes)
			if err != nil {
				return "", err
			}
			passphrase = base64.StdEncoding.EncodeToString(bytes)
		}
		err = backend.setPassphrase(app, stage, passphrase)
		if err != nil {
			return "", err
		}
	}

	existingPassphrase, ok = cache[app+stage]
	return passphrase, nil
}

type Summary struct {
	Version       string         `json:"version"`
	UpdateID      string         `json:"updateID"`
	Command       string         `json:"command"`
	TimeStarted   string         `json:"timeStarted"`
	TimeCompleted string         `json:"timeCompleted"`
	Errors        []SummaryError `json:"errors"`
}

type SummaryError struct {
	URN     string `json:"urn"`
	Message string `json:"message"`
}

type Update struct {
	ID            string         `json:"id"`
	RunID         string         `json:"runID,omitempty"`
	Version       string         `json:"version"`
	Command       string         `json:"command"`
	Errors        []SummaryError `json:"errors"`
	TimeStarted   string         `json:"timeStarted"`
	TimeCompleted string         `json:"timeCompleted,omitempty"`
}

func PutSummary(backend Home, app, stage, updateID string, summary Summary) error {
	slog.Info("putting summary", "app", app, "stage", stage)
	return putData(backend, "summary", app, stage+"/"+updateID, false, summary)
}

func PutUpdate(backend Home, app, stage string, update Update) error {
	slog.Info("putting update", "app", app, "stage", stage)
	update.RunID = os.Getenv("SST_RUN_ID")
	return putData(backend, "update", app, stage+"/"+update.ID, false, update)
}

func GetSecrets(backend Home, app, stage string) (map[string]string, error) {
	if stage == "" {
		stage = "_fallback"
	}
	data := map[string]string{}
	err := getData(backend, "secret", app, stage, true, &data)
	if err != nil {
		return nil, err
	}
	return data, err
}

func PutSecrets(backend Home, app, stage string, data map[string]string) error {
	if stage == "" {
		stage = "_fallback"
	}
	slog.Info("putting secrets", "app", app, "stage", stage)
	if data == nil {
		return nil
	}
	return putData(backend, "secret", app, stage, true, data)
}

func PushState(backend Home, updateID, app, stage, from string) error {
	slog.Info("pushing state", "app", app, "stage", stage, "from", from)
	file, err := os.Open(from)
	if err != nil {
		return nil
	}
	var group errgroup.Group
	fileBytes, err := io.ReadAll(file)
	if err != nil {
		return err
	}
	err = json.Unmarshal(fileBytes, &map[string]interface{}{})
	if err != nil {
		return fmt.Errorf("something has corrupted the state file - refusing to upload: %w", err)
	}
	group.Go(func() error {
		return backend.putData("app", app, stage, bytes.NewReader(fileBytes))
	})
	group.Go(func() error {
		return backend.putData("snapshot", app, stage+"/"+updateID, bytes.NewReader(fileBytes))
	})
	return group.Wait()
}

func PushPartialState(backend Home, updateID, app, stage string, data []byte) error {
	slog.Info("pushing partial state", "updateID", updateID)
	err := json.Unmarshal(data, &map[string]interface{}{})
	if err != nil {
		return fmt.Errorf("something has corrupted the state file - refusing to upload: %w", err)
	}
	return backend.putData("app", app, stage, bytes.NewReader(data))
}

func PushSnapshot(backend Home, updateID, app, stage string, data []byte) error {
	slog.Info("pushing snapshot", "updateID", updateID)
	err := json.Unmarshal(data, &map[string]interface{}{})
	if err != nil {
		return fmt.Errorf("something has corrupted the state file - refusing to upload: %w", err)
	}
	return backend.putData("snapshot", app, stage+"/"+updateID, bytes.NewReader(data))
}

var ErrStateNotFound = fmt.Errorf("state not found")

func PullState(backend Home, app, stage string, out string) error {
	slog.Info("pulling state", "app", app, "stage", stage, "out", out)
	reader, err := backend.getData("app", app, stage)
	if err != nil {
		return err
	}
	if reader == nil {
		return ErrStateNotFound
	}
	file, err := os.Create(out)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, reader)
	if err != nil {
		return err
	}
	return nil
}

type lockData struct {
	Created  time.Time `json:"created"`
	UpdateID string    `json:"updateID"`
	RunID    string    `json:"runID"`
	Command  string    `json:"command"`
	Ignore   bool      `json:"ignore"`
}

func Lock(backend Home, updateID, version, command, app, stage string) error {
	slog.Info("locking", "app", app, "stage", stage)
	var lockData lockData
	err := getData(backend, "lock", app, stage, false, &lockData)
	if err != nil {
		return err
	}
	if !lockData.Created.IsZero() {
		return ErrLockExists
	}
	lockData.RunID = os.Getenv("SST_RUN_ID")
	lockData.Created = time.Now()
	lockData.UpdateID = updateID
	lockData.Command = command
	lockData.Ignore = true
	err = putData(backend, "lock", app, stage, false, lockData)
	if err != nil {
		return err
	}

	err = PutUpdate(backend, app, stage, Update{
		ID:          updateID,
		Version:     version,
		Command:     command,
		Errors:      nil,
		TimeStarted: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}

	return nil
}

func Unlock(backend Home, version, app, stage string) error {
	slog.Info("unlocking", "app", app, "stage", stage)
	return removeData(backend, "lock", app, stage)
}

func ForceUnlock(backend Home, version, app, stage string) error {
	slog.Info("force unlocking", "app", app, "stage", stage)
	var lockData lockData
	err := getData(backend, "lock", app, stage, false, &lockData)
	if err != nil {
		return err
	}
	// if lockData.UpdateID == "" {
	// 	return ErrLockNotFound
	// }
	if lockData.UpdateID != "" {
		err = PutUpdate(backend, app, stage, Update{
			ID:            lockData.UpdateID,
			Command:       lockData.Command,
			RunID:         lockData.RunID,
			Version:       version,
			TimeCompleted: time.Now().Format(time.RFC3339),
			Errors: []SummaryError{
				{
					Message: "Update did not complete and was force unlocked with the `sst unlock` command",
				},
			},
		})
		if err != nil {
			return err
		}
	}
	return removeData(backend, "lock", app, stage)
}

func putData(backend Home, key, app, stage string, encrypt bool, data interface{}) error {
	slog.Info("putting data", "key", key, "app", app, "stage", stage)
	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return err
	}
	if encrypt {
		passphrase, err := Passphrase(backend, app, stage)
		if err != nil {
			return err
		}
		passphraseBytes, err := base64.StdEncoding.DecodeString(passphrase)
		if err != nil {
			return err
		}
		blockCipher, err := aes.NewCipher(passphraseBytes)
		if err != nil {
			return err
		}
		gcm, err := cipher.NewGCM(blockCipher)
		if err != nil {
			return err
		}
		nonce := make([]byte, gcm.NonceSize())
		if _, err = rand.Read(nonce); err != nil {
			return err
		}
		jsonBytes = gcm.Seal(nonce, nonce, jsonBytes, nil)
	}
	return backend.putData(key, app, stage, bytes.NewReader(jsonBytes))
}

func getData(backend Home, key, app, stage string, encrypted bool, out interface{}) error {
	slog.Info("getting data", "key", key, "app", app, "stage", stage)
	reader, err := backend.getData(key, app, stage)
	if err != nil {
		return err
	}
	if reader == nil {
		return nil
	}

	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}

	if encrypted {
		passphrase, err := Passphrase(backend, app, stage)
		if err != nil {
			return err
		}
		passphraseBytes, err := base64.StdEncoding.DecodeString(passphrase)
		if err != nil {
			return err
		}
		blockCipher, err := aes.NewCipher(passphraseBytes)
		if err != nil {
			return err
		}
		gcm, err := cipher.NewGCM(blockCipher)
		if err != nil {
			return err
		}

		nonce, ciphertext := data[:gcm.NonceSize()], data[gcm.NonceSize():]

		data, err = gcm.Open(nil, nonce, ciphertext, nil)
		if err != nil {
			return err
		}
	}

	return json.Unmarshal(data, out)
}

func removeData(backend Home, key, app, stage string) error {
	return backend.removeData(key, app, stage)
}
