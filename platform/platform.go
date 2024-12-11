package platform

import (
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/sst/ion/pkg/js"
)

//go:generate ../scripts/build
//go:embed dist/* src/* functions/* package.json tsconfig.json bun.lockb
var files embed.FS

//go:embed templates/*
var Templates embed.FS

func CopyTo(srcDir, destDir string) error {
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return err
	}
	entries, err := files.ReadDir(srcDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := filepath.Join(srcDir, entry.Name())
		destPath := filepath.Join(destDir, entry.Name())

		if entry.IsDir() {
			// If it's a directory, recursively copy its contents
			if err := CopyTo(srcPath, destPath); err != nil {
				return err
			}
		} else {
			// If it's a file, copy it to the destination directory
			srcFile, err := files.Open(srcPath)
			if err != nil {
				return err
			}
			defer srcFile.Close()

			destFile, err := os.Create(destPath)
			if err != nil {
				return err
			}
			defer destFile.Close()

			if _, err := io.Copy(destFile, srcFile); err != nil {
				return err
			}
		}
	}

	return nil
}

func CopyTemplate(template string, destDir string) {
	fs.WalkDir(files, filepath.Join("src", "templates", template), func(path string, d fs.DirEntry, err error) error {
		if d.IsDir() {
			return nil
		}
		slog.Info("copying template", "path", path)
		return nil
	})
}

func PackageJson() (*js.PackageJson, error) {
	file, err := files.Open("package.json")
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var result js.PackageJson
	err = json.NewDecoder(file).Decode(&result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}
