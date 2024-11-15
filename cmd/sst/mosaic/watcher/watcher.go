package watcher

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/sst/ion/pkg/bus"
)

type FileChangedEvent struct {
	Path string
}

func Start(ctx context.Context, watchPaths []string) error {
	defer slog.Info("watcher done")
	slog.Info("starting watcher", "watchPaths", watchPaths)
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	for _, watchPath := range watchPaths {
		err = watcher.AddWith(watchPath)
		if err != nil {
			return err
		}
		ignoreSubstrings := []string{"node_modules"}

		err = filepath.Walk(watchPath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				if strings.HasPrefix(info.Name(), ".") {
					return filepath.SkipDir
				}
				for _, substring := range ignoreSubstrings {
					if strings.Contains(path, substring) {
						return filepath.SkipDir
					}
				}
				slog.Info("watching", "path", path)
				err = watcher.Add(path)
				if err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}

		headFile := filepath.Join(watchPath, ".git/HEAD")
		watcher.Add(headFile)
	}

	limiter := map[string]time.Time{}
	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return nil
			}

			if strings.HasSuffix(event.Name, ".git/HEAD") {
				return nil
			}
			if event.Op&(fsnotify.Write|fsnotify.Create) == 0 {
				slog.Info("ignoring file event", "path", event.Name, "op", event.Op)
				continue
			}
			slog.Info("file event", "path", event.Name, "op", event.Op)
			if time.Since(limiter[event.Name]) > 500*time.Millisecond {
				limiter[event.Name] = time.Now()
				bus.Publish(&FileChangedEvent{Path: event.Name})
			}
		case <-ctx.Done():
			return nil
		}
	}
}
