package python

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/BurntSushi/toml"
	"github.com/sst/sst/v3/pkg/process"
	"github.com/sst/sst/v3/pkg/project/path"
	"github.com/sst/sst/v3/pkg/runtime"
)

type Worker struct {
	stdout io.ReadCloser
	stderr io.ReadCloser
	cmd    *exec.Cmd
}

func (w *Worker) Stop() {
	// Terminate the whole process group
	process.Kill(w.cmd.Process)
}

func (w *Worker) Logs() io.ReadCloser {
	reader, writer := io.Pipe()

	go func() {
		defer writer.Close()

		var wg sync.WaitGroup
		wg.Add(2)

		copyStream := func(dst io.Writer, src io.Reader, name string) {
			defer wg.Done()
			buf := make([]byte, 1024)
			for {
				n, err := src.Read(buf)
				if n > 0 {
					_, werr := dst.Write(buf[:n])
					if werr != nil {
						slog.Error("error writing to pipe", "stream", name, "err", werr)
						return
					}
				}
				if err != nil {
					if err != io.EOF {
						slog.Error("error reading from stream", "stream", name, "err", err)
					}
					return
				}
			}
		}

		go copyStream(writer, w.stdout, "stdout")
		go copyStream(writer, w.stderr, "stderr")

		wg.Wait()
	}()

	return reader
}

type PythonRuntime struct {
	lastBuiltHandler map[string]string
}

func New() *PythonRuntime {
	return &PythonRuntime{
		lastBuiltHandler: map[string]string{},
	}
}

func (r *PythonRuntime) Build(ctx context.Context, input *runtime.BuildInput) (*runtime.BuildOutput, error) {
	slog.Info("building python function", "handler", input.Handler)

	file, ok := r.getFile(input)
	if !ok {
		return nil, fmt.Errorf("handler not found: %v", input.Handler)
	}
	targetDir := filepath.Join(input.Out(), filepath.Dir(input.Handler))
	if err := os.MkdirAll(targetDir, os.ModePerm); err != nil {
		return nil, fmt.Errorf("failed to create target directory: %v", err)
	}

	baseDir := filepath.Dir(file)
	absTargetDir, err := filepath.Abs(targetDir)
	if err != nil {
		return nil, fmt.Errorf("failed to get absolute path: %v", err)
	}

	pythonFiles, err := getPythonFiles(file)
	if err != nil {
		return nil, err
	}
	for _, file := range pythonFiles {
		relPath, err := filepath.Rel(baseDir, file)
		if err != nil {
			slog.Info("Skipping file %s: unable to determine relative path: %v", file, err)
			continue
		}

		// Determine the target path
		destPath := filepath.Join(absTargetDir, relPath)

		// Copy the file to the target directory
		err = copyFile(file, destPath)
		if err != nil {
			slog.Error("Error copying file", "from", file, "to", destPath, "err", err)
			continue
		}

		slog.Info("Copied file %s to %s", file, destPath)
	}

	// Find the closest pyproject.toml
	startingPath := filepath.Dir(file)
	pyProjectFile, err := FindClosestPyProjectToml(startingPath)
	if err != nil {
		return nil, err
	}

	// Copy pyproject.toml to the output directory
	if err := copyFile(pyProjectFile, filepath.Join(targetDir, filepath.Base(pyProjectFile))); err != nil {
		return nil, err
	}

	// Write the links to resources.json file at the root of the output directory
	resourcesFile := filepath.Join(targetDir, "resources.json")
	if err := writeResourcesFile(resourcesFile, input.Links); err != nil {
		return nil, err
	}

	// We need to check if a deployment instead of dev
	rpcBuildEnabled := false
	if !input.Dev && rpcBuildEnabled {
		// Handle zip and containers differently
		// TODO: walln - handle container flag (not sure how the RPC call is shaped from component?)

		containerDeployment := false
		if containerDeployment {
			// Copy the Dockerfile to the output directory if it exists
			dockerFile := filepath.Join(filepath.Dir(pyProjectFile), "Dockerfile")
			if _, err := os.Stat(dockerFile); err == nil {
				if err := copyFile(dockerFile, filepath.Join(targetDir, "Dockerfile")); err != nil {
					return nil, err
				}
			} else {
				// Copy the default Dockerfile
				defaultDockefilePath := filepath.Join(path.ResolvePlatformDir(input.CfgPath), "functions", "docker", "python.Dockerfile")
				if err := copyFile(defaultDockefilePath, filepath.Join(targetDir, "Dockerfile")); err != nil {
					return nil, err
				}
			}
		} else {
			// In a zip deployment we have to manage the dependency packing without uv's virtualenv since
			// uv is not available in the lambda environment

			// 1. Install python dependencies locally with the correct versions
			// TOOD: walln - when uv supports specifying the platform that would be a good idea
			// but its not there yet
			uvSyncCmd := process.CommandContext(
				ctx,
				"uv",
				"sync")

			// use the output pyproject.toml directory as the working directory
			workDir := filepath.Dir(filepath.Join(targetDir, filepath.Base(pyProjectFile)))

			slog.Info("starting build uv sync", "env", uvSyncCmd.Env, "args", uvSyncCmd.Args)
			uvSyncCmd.Dir = workDir

			err := uvSyncCmd.Run()
			if err != nil {
				return nil, fmt.Errorf("failed to run uv sync: %v", err)
			}

			// 2. Convert the virtualenv to site-packages so that lambda can find the packages
			sitePackagesCmd := process.CommandContext(
				ctx,
				"cp",
				"-r",
				filepath.Join(workDir, ".venv", "lib", "python3.*", "site-packages", "*"),
				filepath.Join(targetDir))

			slog.Info("starting build site packages", "env", sitePackagesCmd.Env, "args", sitePackagesCmd.Args)
			sitePackagesCmd.Dir = workDir

			err = sitePackagesCmd.Run()
			if err != nil {
				return nil, fmt.Errorf("failed to run site packages: %v", err)
			}

			// 3. Remove the virtualenv because it does not need to be included in the zip
			removeVirtualEnvCmd := process.CommandContext(
				ctx,
				"rm",
				"-rf",
				filepath.Join(workDir, ".venv"))

			slog.Info("starting build remove virtual env", "env", removeVirtualEnvCmd.Env, "args", removeVirtualEnvCmd.Args)
			removeVirtualEnvCmd.Dir = workDir

			err = removeVirtualEnvCmd.Run()
			if err != nil {
				return nil, fmt.Errorf("failed to run remove virtual env: %v", err)
			}
		}

	}

	r.lastBuiltHandler[input.FunctionID] = file

	errors := []string{}

	return &runtime.BuildOutput{
		Handler: input.Handler,
		Errors:  errors,
	}, nil
}

func (r *PythonRuntime) Match(runtime string) bool {
	return strings.HasPrefix(runtime, "python")
}

type Source struct {
	URL          string  `toml:"url,omitempty"`
	Git          string  `toml:"git,omitempty"`
	Subdirectory *string `toml:"subdirectory,omitempty"`
	Branch       string  `toml:"branch,omitempty"`
}

type PyProject struct {
	Project struct {
		Dependencies []string `toml:"dependencies"`
	} `toml:"project"`
	Tool struct {
		Uv struct {
			Sources map[string]Source `toml:"sources"`
		} `toml:"uv"`
	} `toml:"tool"`
}

func (r *PythonRuntime) Run(ctx context.Context, input *runtime.RunInput) (runtime.Worker, error) {
	// Get the directory of the Handler
	handlerDir := filepath.Dir(filepath.Join(input.Build.Out, input.Build.Handler))

	// We have to manually construct the dependencies to install because uv currently does not support importing a
	// foreign pyproject.toml as a configuration file and we have to run the python-runtime file rather than
	// the handler file

	// Get the absolute path of the pyproject.toml file
	pyprojectFile, err := FindClosestPyProjectToml(handlerDir)
	if err != nil {
		return nil, err
	}

	// Decode the TOML file
	var pyProject PyProject
	if _, err := toml.DecodeFile(pyprojectFile, &pyProject); err != nil {
		slog.Error("Error decoding TOML file", "err", err)
	}

	// Extract the dependencies
	dependencies := pyProject.Project.Dependencies

	// Extract the sources
	sources := pyProject.Tool.Uv.Sources

	args := []string{
		"run",
		"--no-project",
		"--with",
		"requests",
	}

	// We need to check if the dependency is a git dependency
	// If it is, we can confirm if its in the uv.sources as a git dependency
	// then we need to remove it from the dependencies list
	filteredDependencies := []string{}
	// Iterate over each dependency
	for _, dep := range dependencies {
		// Check if the dependency is in the sources map
		if source, exists := sources[dep]; exists {
			if source.Git != "" {
				// It's a Git dependency listed in sources, so skip it
				slog.Debug("Skipping dependency: %s (Git: %s)\n", dep, source.Git)
				continue
			}
		}
		// Add the dependency to the filtered list if it's not a Git dependency
		filteredDependencies = append(filteredDependencies, dep)
	}
	dependencies = filteredDependencies

	for _, dep := range dependencies {
		args = append(args, "--with", dep)
	}

	// If sources are specified, use them
	if len(sources) > 0 {
		for _, source := range sources {
			if source.URL != "" {
				args = append(args, "--find-links", source.URL)
			} else if source.Git != "" {
				repo_url := "git+" + source.Git
				if source.Branch != "" {
					repo_url = repo_url + "@" + source.Branch
				}
				if source.Subdirectory != nil {
					repo_url = repo_url + "#subdirectory=" + *source.Subdirectory
				}
				// uv run --with git+https://github.com/sst/sst/v3.git#subdirectory=sdk/python python.py
				args = append(args, "--with", repo_url)
			}
		}
	}

	args = append(args,
		filepath.Join(path.ResolvePlatformDir(input.CfgPath), "/dist/python-runtime/index.py"),
		filepath.Join(input.Build.Out, input.Build.Handler),
		input.WorkerID,
	)

	cmd := process.CommandContext(
		ctx,
		"uv",
		args...)
	cmd.Env = append(input.Env, "AWS_LAMBDA_RUNTIME_API="+input.Server)
	slog.Info("starting worker", "env", cmd.Env, "args", cmd.Args)
	cmd.Dir = input.Build.Out
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %v", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %v", err)
	}
	cmd.Start()
	return &Worker{
		stdout,
		stderr,
		cmd,
	}, nil
}

func (r *PythonRuntime) ShouldRebuild(functionID string, file string) bool {
	return true
}

var PYTHON_EXTENSIONS = []string{".py"}

func (r *PythonRuntime) getFile(input *runtime.BuildInput) (string, bool) {
	slog.Info("getting python file", "handler", input.Handler)
	dir := filepath.Dir(input.Handler)
	base := strings.TrimSuffix(filepath.Base(input.Handler), filepath.Ext(input.Handler))
	for _, ext := range PYTHON_EXTENSIONS {
		file := filepath.Join(path.ResolveRootDir(input.CfgPath), dir, base+ext)
		if _, err := os.Stat(file); err == nil {
			return file, true
		}
	}
	return "", false
}

func copyFile(src, dst string) error {
	// Open the source file
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	// Ensure the destination directory exists
	destDir := filepath.Dir(dst)
	if err := os.MkdirAll(destDir, os.ModePerm); err != nil {
		return fmt.Errorf("failed to create destination directories for %s: %v", dst, err)
	}

	// Create the destination file
	destinationFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destinationFile.Close()

	// Copy the content from source to destination
	_, err = io.Copy(destinationFile, sourceFile)
	if err != nil {
		return err
	}

	// Flush the writes to stable storage
	err = destinationFile.Sync()
	if err != nil {
		return err
	}

	return nil
}

// FindClosestPyProjectToml traverses up the directory tree to find the closest pyproject.toml file.
func FindClosestPyProjectToml(startingPath string) (string, error) {
	dir := startingPath
	for {
		pyProjectFile := filepath.Join(dir, "pyproject.toml")
		if _, err := os.Stat(pyProjectFile); err == nil {
			return pyProjectFile, nil
		}

		// Move up one directory
		parentDir := filepath.Dir(dir)
		if parentDir == dir {
			// Reached the root directory
			break
		}
		dir = parentDir
	}
	return "", fmt.Errorf("pyproject.toml not found")
}

func getPythonFiles(filePath string) ([]string, error) {
	// Get the absolute path of the file
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to get absolute path: %v", err)
	}

	// Get the directory of the file
	dir := filepath.Dir(absPath)

	var pythonFiles []string

	// Walk through the directory
	err = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// If there's an error accessing the path, skip it
			return nil
		}

		// Skip any directory named "__pycache__"
		if d.IsDir() && d.Name() == "__pycache__" {
			return filepath.SkipDir
		}

		// If it's a file, check the extension
		if !d.IsDir() {
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if ext == ".py" || ext == ".pyi" {
				pythonFiles = append(pythonFiles, path)
			}
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error walking the path: %v", err)
	}

	return pythonFiles, nil
}

func writeResourcesFile(resourcesFile string, links map[string]json.RawMessage) error {
	jsonData, err := json.MarshalIndent(links, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal links to JSON: %v", err)
	}

	// determine the directory of the resources file
	dir := filepath.Dir(resourcesFile)

	// create the directory if it doesn't exist
	if err := os.MkdirAll(dir, os.ModePerm); err != nil {
		return fmt.Errorf("failed to create directory %s: %v", dir, err)
	}

	// write the JSON data to the resources file
	err = os.WriteFile(resourcesFile, jsonData, os.ModePerm)
	if err != nil {
		return fmt.Errorf("failed to write JSON data to %s: %v", resourcesFile, err)
	}

	return nil
}
