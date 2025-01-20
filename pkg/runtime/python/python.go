package python

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	/// Workspaces are the most challenging part of the build process
	/// UV currently does not support --include-workspace-deps for builds
	/// See: https://github.com/astral-sh/uv/issues/6935 hopefully this lands soon

	/// As a result, we have to manually construct the dependency tree
	/// So we need to:
	///
	/// 1. Build all packages (future tree shaking would be nice)
	/// 2. Ensure local packages are built for lambdaric acccess (remove src/ nesting)
	///			To future readers: we need to do this because of the way python packages are resolved
	///			if you have a package called "mypackage" and it contains a sub-package called "src/mypackage"
	///			then within the package you can resolve code via "import mypackage" but not "import mypackage.src.mypackage"
	///			this means that builds get a little strange for aws lambda which does module level imports via lambdaric
	///			so we need to ensure that the package is built such that lambdaric can resolve paths in the output bundle
	///			but the full package is available for local development
	/// 3. Export the uv package index to requirements.txt
	/// 4. Install the dependencies into the artifact directory as a target (local for zip and delegate to the dockerfile for containers)

	file, err := r.getFile(input)
	if err != nil {
		return nil, fmt.Errorf("handler not found: %v", err)
	}

	build, err := r.CreateBuildAsset(ctx, input)
	if err != nil {
		return nil, err
	}
	r.lastBuiltHandler[input.FunctionID] = file

	return build, nil

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
		Name string `toml:"name"`
	} `toml:"project"`
}

func (r *PythonRuntime) Run(ctx context.Context, input *runtime.RunInput) (runtime.Worker, error) {
	// We need the lambda bridge in the artifact directory so that we can run the handler
	// without having to manually isolate the runtime, So if it is not present then we need to copy it from
	// the platform directory into the artifact directory

	// Check if the lambda bridge is present
	lambdaBridgePath := filepath.Join(input.Build.Out, "lambdaric_python_bridge.py")
	if _, err := os.Stat(lambdaBridgePath); os.IsNotExist(err) {
		// Copy the lambda bridge from the platform directory into the artifact directory
		err := copyFile(filepath.Join(path.ResolvePlatformDir(input.CfgPath), "/dist/python-runtime/index.py"), lambdaBridgePath)
		if err != nil {
			return nil, fmt.Errorf("failed to copy lambda bridge: %v", err)
		}
	}

	cmd := process.CommandContext(
		ctx,
		"uv",
		"run",
		"--with=requests",
		lambdaBridgePath,
		filepath.Join(input.Build.Out, input.Build.Handler),
		input.WorkerID,
	)
	cmd.Env = append(input.Env, "AWS_LAMBDA_RUNTIME_API="+input.Server)
	cmd.Dir = input.Build.Out
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %v", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %v", err)
	}

	slog.Info("starting worker", "env", cmd.Env, "args", cmd.Args)
	cmd.Start()

	return &Worker{
		stdout,
		stderr,
		cmd,
	}, nil

}

func (r *PythonRuntime) ShouldRebuild(functionID string, file string) bool {
	// Assume that the build is always stale. We could do a better job here but bc of how the build
	// process actually works its not a slowdown as the real slow part is starting the python interpreter
	// This is neglible for now and will get faster when we can move to uv's native build system.
	// We could also pre-warm the runtime - custom watcher paths would be useful here.
	return true
}

func (r *PythonRuntime) CreateBuildAsset(ctx context.Context, input *runtime.BuildInput) (*runtime.BuildOutput, error) {
	// Get the architecture from the input.properties.architecture json field
	slog.Info("input properties", "json", string(input.Properties))

	type Properties struct {
		Architecture string `json:"architecture"`
		Container    bool   `json:"container"`
	}
	var props Properties
	if err := json.Unmarshal(input.Properties, &props); err != nil {
		return nil, fmt.Errorf("failed to parse properties: %v", err)
	}

	arch := props.Architecture
	if arch == "" {
		arch = "x86_64" // Default to x86_64
	}

	if arch != "x86_64" && arch != "arm64" {
		return nil, fmt.Errorf("invalid architecture %q - must be x86_64 or arm64 - %v", arch, string(input.Properties))
	}
	workingDir := path.ResolveRootDir(input.CfgPath)

	// 1. Generate non-local package index
	syncCmd := process.CommandContext(ctx, "uv", "sync", "--all-packages")
	syncCmd.Dir = workingDir
	slog.Info("running uv sync in dir", "dir", syncCmd.Dir)

	// capture the output of the sync command
	syncOutput, err := syncCmd.CombinedOutput()
	if err != nil {
		slog.Error("failed to run uv sync", "error", err, "output", string(syncOutput))
		return nil, fmt.Errorf("failed to run uv sync: %v\n%s", err, string(syncOutput))
	}
	slog.Error("uv sync output", "output", string(syncOutput))

	outputRequirementsFile := filepath.Join(input.Out(), "requirements.txt")
	packageName, err := r.getPackageName(input)
	if err != nil {
		return nil, fmt.Errorf("failed to get package name: %v", err)
	}
	exportCmd := process.CommandContext(ctx, "uv", "export", "--package="+packageName, "--output-file="+outputRequirementsFile, "--no-emit-workspace")
	exportCmd.Dir = workingDir
	err = exportCmd.Run()
	if err != nil {
		return nil, fmt.Errorf("failed to run uv export: %v", err)
	}

	// 2. Build the entire workspace - this should cache and be fast thank you astral
	buildCmd := process.CommandContext(ctx, "uv", "build", "--all", "--sdist", "--out-dir="+input.Out())
	buildCmd.Dir = workingDir
	buildOutput, err := buildCmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to run uv build: %v\n%s", err, string(buildOutput))
	}
	slog.Error("uv build output", "output", string(buildOutput))

	// 3. Decode each tar.gz file in the dist directory and remove the trailing "-{version}"
	files, err := filepath.Glob(filepath.Join(input.Out(), "*.tar.gz"))
	if err != nil {
		return nil, fmt.Errorf("failed to glob tar.gz files: %v", err)
	}

	for _, file := range files {
		// Extract the tar.gz file
		cmd := process.CommandContext(ctx, "tar", "-xzf", file, "-C", input.Out())
		cmd.Dir = input.Out()
		err = cmd.Run()
		if err != nil {
			return nil, fmt.Errorf("failed to extract tar.gz file: %v", err)
		}

		// Get the directory name without version number
		dirName := strings.TrimSuffix(filepath.Base(file), ".tar.gz")
		lastHyphen := strings.LastIndex(dirName, "-")
		baseName := dirName[:lastHyphen]

		extractedDir := filepath.Join(input.Out(), dirName)
		targetDir := filepath.Join(input.Out(), baseName)

		// Check if the package has a src/{package_name} structure
		srcPath := filepath.Join(extractedDir, "src", baseName)
		if _, err := os.Stat(srcPath); err == nil {
			// Remove old directory if it exists
			if err := os.RemoveAll(targetDir); err != nil {
				return nil, fmt.Errorf("failed to remove old directory: %v", err)
			}
			// Move the contents from src/{package_name} directly to the target
			if err := os.Rename(srcPath, targetDir); err != nil {
				return nil, fmt.Errorf("failed to move src directory contents: %v", err)
			}
			// Clean up the original extracted directory
			if err := os.RemoveAll(extractedDir); err != nil {
				return nil, fmt.Errorf("failed to clean up extracted directory: %v", err)
			}
		} else {
			// Handle the regular case (no src directory)
			if err := os.RemoveAll(targetDir); err != nil {
				return nil, fmt.Errorf("failed to remove old directory: %v", err)
			}
			if err := os.Rename(extractedDir, targetDir); err != nil {
				return nil, fmt.Errorf("failed to rename directory: %v", err)
			}
		}
	}

	// 4. Remove the tar.gz files (non-recursive)
	for _, file := range files {
		err = os.Remove(file)
		if err != nil {
			return nil, fmt.Errorf("failed to remove tar.gz file: %v", err)
		}
	}

	// If making a zip build or a local build then we need to install the dependencies and adjust the handler path
	if !input.IsContainer || input.Dev {

		// 5. Install the dependencies as a target
		args := []string{"pip", "install", "-r", outputRequirementsFile, "--target", input.Out()}
		if !input.Dev {
			// If we are not in dev mode then we need to install the dependencies for the target platform
			// which is amazon linux for the correct architecture
			pythonPlatform := "x86_64-unknown-linux-gnu"
			if arch == "arm64" {
				pythonPlatform = "aarch64-unknown-linux-gnu"
			}
			args = append(args, "--python-platform", pythonPlatform)
		}
		installCmd := process.CommandContext(ctx, "uv", args...)
		installCmd.Dir = input.Out()
		installOutput, err := installCmd.CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("failed to run uv pip install: %v\n%s", err, string(installOutput))
		}
		slog.Error("uv pip install output", "output", string(installOutput), "error", err)

		// Adjust handler path if it contains the pattern {package_name}/src/{package_name}
		adjustedHandler, err := r.adjustHandlerPath(input)
		if err != nil {
			return nil, fmt.Errorf("failed to adjust handler path: %v", err)
		}
		slog.Info("built python function", "handler", adjustedHandler, "out", input.Out())

		errors := []string{}
		sourcemaps := []string{}

		return &runtime.BuildOutput{
			Handler:    adjustedHandler,
			Errors:     errors,
			Sourcemaps: sourcemaps,
		}, nil
	} else {
		// 5. Check if there is a Dockerfile in the handler directory
		// 	If not then copy over the default one from the platform directory
		workspaceDir, err := r.getWorkspaceDirectory(input)
		if err != nil {
			return nil, fmt.Errorf("failed to get workspace directory: %v", err)
		}

		slog.Info("checking for Dockerfile in workspace directory", "dir", workspaceDir)
		_, err = os.Stat(filepath.Join(workspaceDir, "Dockerfile"))
		if err != nil {
			slog.Error("workspace directory does not contain Dockerfile", "dir", workspaceDir)
			// Check if the Dockerfile exists in the platform directory
			defaultDockerfilePath := filepath.Join(path.ResolvePlatformDir(input.CfgPath), "/dist/dockerfiles/python.Dockerfile")
			_, err = os.Stat(defaultDockerfilePath)
			if err != nil {
				slog.Error("failed to check for Dockerfile in platform directory", "error", err)
				return nil, fmt.Errorf("failed to check for Dockerfile in platform directory: %v", err)
			} else {
				slog.Info("dockerfile exists in platform directory", "dir", path.ResolvePlatformDir(input.CfgPath))
			}

			slog.Info("copying default Dockerfile from platform directory to output directory", "dir", path.ResolvePlatformDir(input.CfgPath))

			// Copy over the default Dockerfile from the platform directory
			copyFile(defaultDockerfilePath, filepath.Join(input.Out(), "Dockerfile"))
			slog.Info("copied default Dockerfile to output directory", "dir", input.Out())
		} else {
			slog.Info("Dockerfile already exists in workspace directory", "dir", workspaceDir)
			copyFile(filepath.Join(workspaceDir, "Dockerfile"), filepath.Join(input.Out(), "Dockerfile"))
		}

		adjustedHandler, err := r.adjustHandlerPath(input)
		if err != nil {
			return nil, fmt.Errorf("failed to adjust handler path: %v", err)
		}

		errors := []string{}
		sourcemaps := []string{}

		return &runtime.BuildOutput{
			Handler:    adjustedHandler,
			Errors:     errors,
			Sourcemaps: sourcemaps,
		}, nil
	}
}

func (r *PythonRuntime) getFile(input *runtime.BuildInput) (string, error) {
	slog.Info("looking for python handler file", "handler", input.Handler)

	dir := filepath.Dir(input.Handler)
	base := strings.TrimSuffix(filepath.Base(input.Handler), filepath.Ext(input.Handler))
	rootDir := path.ResolveRootDir(input.CfgPath)

	// Look for .py file
	pythonFile := filepath.Join(rootDir, dir, base+".py")
	if _, err := os.Stat(pythonFile); err == nil {
		return pythonFile, nil
	}

	// No Python file found for the handler
	return "", fmt.Errorf("could not find Python file '%s.py' in directory '%s'",
		base,
		filepath.Join(rootDir, dir))
}

func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("failed to open source file: %v", err)
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("failed to create destination file: %v", err)
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	if err != nil {
		return fmt.Errorf("failed to copy file contents: %v", err)
	}

	return nil
}

func (r *PythonRuntime) getWorkspaceDirectory(input *runtime.BuildInput) (string, error) {
	file, err := r.getFile(input)
	if err != nil {
		return "", err
	}

	projectRoot := path.ResolveRootDir(input.CfgPath)
	currentDir := filepath.Dir(file)

	// First verify that the current directory is within the project root
	if !strings.HasPrefix(currentDir, projectRoot) {
		return "", fmt.Errorf("handler file %s is not within the project root %s", file, projectRoot)
	}

	// Traverse up the file tree to find the pyproject.toml file
	// If we reach the project root then return an error
	for {
		pyprojectPath := filepath.Join(currentDir, "pyproject.toml")
		if _, err := os.Stat(pyprojectPath); err == nil {
			// We found the pyproject.toml file
			return currentDir, nil
		}

		// Move up the directory tree
		parentDir := filepath.Dir(currentDir)

		// Check if we have reached the project root or cannot move up anymore
		if parentDir == currentDir || currentDir == projectRoot {
			return "", fmt.Errorf("no pyproject.toml found in directory tree from %s up to project root %s", filepath.Dir(file), projectRoot)
		}

		currentDir = parentDir
	}
}

func (r *PythonRuntime) getPackageName(input *runtime.BuildInput) (string, error) {
	workspaceDir, err := r.getWorkspaceDirectory(input)
	if err != nil {
		return "", err
	}

	// Read the pyproject.toml file
	pyproject, err := os.ReadFile(filepath.Join(workspaceDir, "pyproject.toml"))
	if err != nil {
		return "", fmt.Errorf("failed to read pyproject.toml file: %v", err)
	}

	// Parse the pyproject.toml file
	pyprojectData := PyProject{}
	err = toml.Unmarshal(pyproject, &pyprojectData)
	if err != nil {
		return "", fmt.Errorf("failed to parse pyproject.toml file: %v", err)
	}

	return pyprojectData.Project.Name, nil

}

func (r *PythonRuntime) adjustHandlerPath(input *runtime.BuildInput) (string, error) {
	handlerParts := strings.Split(input.Handler, "/")
	adjustedHandler := input.Handler
	if len(handlerParts) >= 3 {
		// Start from the back, using a sliding window of 3
		for i := len(handlerParts) - 3; i >= 0; i-- {
			// Check if we have enough parts left to match the pattern
			if i+2 >= len(handlerParts) {
				continue
			}

			pkgName := handlerParts[i]
			if handlerParts[i+1] == "src" && handlerParts[i+2] == pkgName {
				// Found the pattern, now remove the middle two parts (src/{package_name})
				newParts := append(
					handlerParts[:i+1],
					handlerParts[i+3:]...,
				)
				adjustedHandler = strings.Join(newParts, "/")
				slog.Info("adjusted handler path", "original", input.Handler, "adjusted", adjustedHandler)
				break
			}

			// Stop if we would go beyond the project root
			absPath := filepath.Join(path.ResolveRootDir(input.CfgPath), strings.Join(handlerParts[:i], "/"))
			if !strings.HasPrefix(absPath, path.ResolveRootDir(input.CfgPath)) {
				break
			}
		}
	}
	return adjustedHandler, nil
}
