package project

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"

	"github.com/sst/sst/v3/internal/util"
	"github.com/sst/sst/v3/pkg/npm"
	"github.com/sst/sst/v3/platform"
	"github.com/tailscale/hujson"
)

type step struct {
	Type       string          `json:"type"`
	Properties json.RawMessage `json:"properties"`
}

type copyStep struct {
}

type npmStep struct {
	Package string `json:"package"`
	Version string `json:"version"`
	File    string `json:"file"`
	Dev     bool   `json:"dev"`
}

type instructionsStep []string

type patchStep struct {
	Patch json.RawMessage `json:"patch"`
	File  string          `json:"file"`
	Regex []struct {
		Find    string `json:"find"`
		Replace string `json:"replace"`
	} `json:"regex"`
}

type jsonPatch struct {
	Op    string      `json:"op"`
	Path  string      `json:"path"`
	Value interface{} `json:"value"`
}

type gitignoreStep struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type preset struct {
	Steps []step `json:"steps"`
}

var ErrConfigExists = fmt.Errorf("sst.config.ts already exists")
var ErrPackageJsonInvalid = fmt.Errorf("package.json is invalid")

func Create(templateName string, home string) ([]string, error) {
	gitignoreSteps := []gitignoreStep{
		{
			Name: "# sst",
			Path: ".sst",
		},
	}

	if _, err := os.Stat("sst.config.ts"); err == nil {
		return nil, ErrConfigExists
	}

	currentDirectory, err := os.Getwd()
	if err != nil {
		return nil, nil
	}
	directoryName := strings.ToLower(filepath.Base(currentDirectory))
	slog.Info("creating project", "name", directoryName)

	presetBytes, err := platform.Templates.ReadFile(filepath.Join("templates", templateName, "preset.json"))
	if err != nil {
		return nil, fmt.Errorf("failed to read preset.json: %w", err)
	}
	var preset preset
	err = json.Unmarshal(presetBytes, &preset)
	if err != nil {
		return nil, err
	}

	packageJsons := map[string]util.KeyValuePairs[interface{}]{}
	instructions := []string{}

	for _, step := range preset.Steps {
		slog.Info("step", "type", step.Type)
		switch step.Type {
		case "instructions":
			var instructionsStep instructionsStep
			err = json.Unmarshal(step.Properties, &instructionsStep)
			if err != nil {
				return nil, err
			}
			instructions = append(instructions, instructionsStep...)
			break
		case "npm":
			var npmStep npmStep
			err = json.Unmarshal(step.Properties, &npmStep)
			if err != nil {
				return nil, err
			}
			slog.Info("installing npm package", "package", npmStep.Package, "version", npmStep.Version)
			packageJson := packageJsons[npmStep.File]
			if packageJson == nil {
				slog.Info("reading package.json", "file", npmStep.File)
				f, err := os.Open(npmStep.File)
				if err != nil {
					return nil, err
				}
				err = json.NewDecoder(f).Decode(&packageJson)
				if err != nil {
					return nil, err
				}
				packageJsons[npmStep.File] = packageJson
			}

			field := "dependencies"
			if npmStep.Dev {
				field = "devDependencies"
			}
			var target map[string]interface{}
			for _, item := range packageJson {
				if item.Key == field {
					target = item.Value.(map[string]interface{})
				}
			}
			if target == nil {
				target = map[string]interface{}{}
				packageJson = append(packageJson, util.KeyValuePair[interface{}]{Key: field, Value: target})
				packageJsons[npmStep.File] = packageJson
			}

			version := npmStep.Version
			if version == "" {
				slog.Info("fetching latest version", "package", npmStep.Package)
				data, err := npm.Get(npmStep.Package, "latest")
				if err != nil {
					return nil, err
				}
				slog.Info("latest version", "version", data.Version)
				version = data.Version
			}
			target[npmStep.Package] = version

		case "patch":
			var patchStep patchStep
			err = json.Unmarshal(step.Properties, &patchStep)
			if err != nil {
				return nil, err
			}
			slog.Info("patching", "file", patchStep.File, "patch", patchStep.Patch)

			b, err := os.ReadFile(patchStep.File)
			if err != nil {
				if os.IsNotExist(err) {
					slog.Info("file does not exist, ignoring patch", "file", patchStep.File)
					continue
				}
				return nil, err
			}

			value, err := hujson.Parse(b)
			if err != nil {
				return nil, err
			}

			if string(patchStep.Patch) != "" {
				var patches []jsonPatch
				err := json.Unmarshal(patchStep.Patch, &patches)
				if err != nil {
					return nil, err
				}
				for _, patch := range patches {
					if patch.Op == "add" {
						splits := strings.Split(patch.Path, "/")
						for i := range splits[:len(splits)-1] { // Exclude the last element
							path := strings.Join(splits[:i+1], "/")
							match := value.Find(path)
							if match == nil {
								// Determine if we should add an array or object
								nextSegment := splits[i+1]
								var fillValue string
								if nextSegment == "-" {
									// Next segment is "-", so we should create an array
									fillValue = "[]"
								} else {
									// Otherwise, create an object
									fillValue = "{}"
								}

								fill := fmt.Sprintf(`[{"op":"add","path":"%s","value":%s}]`, path, fillValue)
								err := value.Patch([]byte(fill))
								if err != nil {
									return nil, err
								}
							}
						}
					}
				}
				err = value.Patch(patchStep.Patch)
				if err != nil {
					return nil, err
				}
			}

			packed := string(value.Pack())
			for _, pattern := range patchStep.Regex {
				re := regexp.MustCompile(pattern.Find)
				packed = re.ReplaceAllString(packed, pattern.Replace)
			}

			file, err := os.Create(patchStep.File)
			if err != nil {
				return nil, err
			}
			defer file.Close()
			_, err = file.WriteString(packed)
			if err != nil {
				return nil, err
			}

			break

		case "copy":
			templateFilesPath := filepath.Join("templates", templateName, "files")
			err = fs.WalkDir(platform.Templates, templateFilesPath, func(path string, d fs.DirEntry, err error) error {
				if d.IsDir() {
					// Create the directory if it doesn't exist
					dir := filepath.Join(".", strings.TrimPrefix(path, templateFilesPath))
					if dir == "" {
						return nil
					}
					err := os.MkdirAll(dir, 0755)
					if err != nil {
						return err
					}
					return nil
				}

				src, err := platform.Templates.ReadFile(path)
				if err != nil {
					return err
				}

				name := filepath.Join(".", strings.TrimPrefix(path, templateFilesPath))

				slog.Info("copying template", "path", path)
				tmpl, err := template.New(path).Parse(string(src))
				data := struct {
					App  string
					Home string
				}{
					App:  directoryName,
					Home: home,
				}

				if _, err := os.Stat(name); err == nil {
					return nil
				}
				output, err := os.Create(name)
				if err != nil {
					return err
				}
				defer output.Close()

				err = tmpl.Execute(output, data)
				if err != nil {
					return err
				}

				return nil
			})
			if err != nil {
				return nil, err
			}
			break

		case "gitignore":
			var gitignoreStep gitignoreStep
			err = json.Unmarshal(step.Properties, &gitignoreStep)
			if err != nil {
				return nil, err
			}
			slog.Info("handling .gitignore", "section", gitignoreStep.Name)
			gitignoreSteps = append(gitignoreSteps, gitignoreStep)
		}
	}

	for p, content := range packageJsons {
		file, err := os.Create(p)
		if err != nil {
			return nil, err
		}
		encoder := json.NewEncoder(file)
		encoder.SetEscapeHTML(false)
		encoder.SetIndent("", "  ")
		err = encoder.Encode(content)
		if err != nil {
			return nil, err
		}
	}

	// Update .gitignore
	gitignoreFilename := ".gitignore"
	file, err := os.OpenFile(gitignoreFilename, os.O_RDWR|os.O_CREATE, 0666)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	bytes, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}
	content := string(bytes)

	for _, step := range gitignoreSteps {
		if !strings.Contains(content, step.Path) {
			if content != "" && !strings.HasSuffix(content, "\n") {
				file.WriteString("\n")
			}
			_, err := file.WriteString("\n" + step.Name + "\n" + step.Path + "\n")
			if err != nil {
				return nil, err
			}
		}
	}

	return instructions, nil
}
