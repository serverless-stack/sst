package server

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"

	"github.com/sst/sst/v3/pkg/project"
)

type registry struct {
	types map[string]reflect.Type
}

func NewRegistry() *registry {
	return &registry{
		types: make(map[string]reflect.Type),
	}
}

func (r *registry) Register(v interface{}) {
}

func (r *registry) Get(name string) (reflect.Type, bool) {
	t, ok := r.types[name]
	return t, ok
}

func resolveServerFile(cfgPath, stage string) string {
	return filepath.Join(project.ResolveWorkingDir(cfgPath), stage+".server")
}

var ErrServerNotFound = errors.New("server not found")

func Discover(cfgPath string, stage string) (string, error) {
	if env := os.Getenv("SST_SERVER"); env != "" {
		return env, nil
	}
	resolved := resolveServerFile(cfgPath, stage)
	contents, err := os.ReadFile(resolved)
	if err != nil {
		if os.IsNotExist(err) {
			return "", ErrServerNotFound
		}
		return "", err
	}
	return string(contents), nil
}
