package provider

import (
	"bytes"
	"fmt"
	"github.com/sst/sst/v3/pkg/global"
	"io"
	"os"
	"path/filepath"
)

type LocalHome struct {
}

func NewLocalHome() *LocalHome {
	return &LocalHome{}
}

func (l *LocalHome) Bootstrap() error {
	return nil
}

func (l *LocalHome) getData(key, app, stage string) (io.Reader, error) {
	p := l.pathForData(key, app, stage)
	result, err := os.Open(p)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return result, nil
}

func (l *LocalHome) putData(key, app, stage string, data io.Reader) error {
	if key == "summary" {
		return nil
	}
	p := l.pathForData(key, app, stage)
	err := os.MkdirAll(filepath.Dir(p), 0755)
	if err != nil {
		return err
	}
	file, err := os.Create(p)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, data)
	if err != nil {
		return err
	}
	return nil
}

func (l *LocalHome) removeData(key, app, stage string) error {
	p := l.pathForData(key, app, stage)
	return os.Remove(p)
}

// these should go into secrets manager once it's out of beta
func (c *LocalHome) setPassphrase(app, stage string, passphrase string) error {
	return c.putData("passphrase", app, stage, bytes.NewReader([]byte(passphrase)))
}

func (c *LocalHome) getPassphrase(app, stage string) (string, error) {
	data, err := c.getData("passphrase", app, stage)
	if err != nil {
		return "", err
	}
	if data == nil {
		return "", nil
	}
	read, err := io.ReadAll(data)
	if err != nil {
		return "", err
	}
	return string(read), nil
}

func (l *LocalHome) pathForData(key, app, stage string) string {
	return filepath.Join(global.ConfigDir(), "state", key, app, fmt.Sprintf("%v.json", stage))
}
