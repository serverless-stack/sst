package node

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/sst/sst/v3/pkg/process"
	"golang.org/x/sync/errgroup"
)

type message struct {
	ID      int            `json:"id"`
	Command string         `json:"command"`
	Value   map[string]any `json:"value"`
}

type request struct {
	Command string
	Chan    chan map[string]any
	Value   map[string]any
}

func plugin(path string) api.Plugin {
	cwd, _ := os.Getwd()
	path = filepath.Join(cwd, path)
	return api.Plugin{
		Name: "nodejs-plugin",
		Setup: func(build api.PluginBuild) {
			slog.Info("nodejs plugin", "path", path)
			cmd := process.Command("node", ".sst/platform/functions/nodejs-runtime/plugin.mjs", path)
			var wg errgroup.Group
			// cmd.Stderr = os.Stderr
			stdin, err := cmd.StdinPipe()
			if err != nil {
				return
			}
			stdout, err := cmd.StdoutPipe()
			if err != nil {
				return
			}
			if err := cmd.Start(); err != nil {
				return
			}
			requests := make(chan request, 0)
			responses := make(chan message, 0)

			request := func(command string, input map[string]any) map[string]any {
				c := make(chan map[string]any)
				requests <- request{Command: command, Chan: c, Value: input}
				return <-c
			}

			wg.Go(func() error {
				count := 0
				encoder := json.NewEncoder(stdin)
				pending := map[int]chan map[string]any{}
				for {
					select {
					case req, ok := <-requests:
						if !ok {
							return nil
						}
						encoder.Encode(message{
							Command: req.Command,
							ID:      count,
							Value:   req.Value,
						})
						pending[count] = req.Chan
						count++
					case reply, ok := <-responses:
						if !ok {
							return nil
						}
						match, ok := pending[reply.ID]
						if !ok {
							continue
						}
						delete(pending, reply.ID)
						match <- reply.Value
					}
				}
			})
			wg.Go(func() error {
				decoder := json.NewDecoder(stdout)
				for {
					var reply message
					err := decoder.Decode(&reply)
					if err != nil {
						if err == io.EOF {
							return nil
						}
						return err
					}
					responses <- reply
				}
			})
			build.OnResolve(api.OnResolveOptions{Filter: ".*"}, func(args api.OnResolveArgs) (api.OnResolveResult, error) {
				with := make(map[string]interface{}, len(args.With))
				for k, v := range args.With {
					with[k] = v
				}
				response := request("resolve", map[string]interface{}{
					"path":       args.Path,
					"importer":   args.Importer,
					"namespace":  args.Namespace,
					"resolveDir": args.ResolveDir,
					"kind":       resolveKindToString(args.Kind),
					"pluginData": args.PluginData,
					"with":       with,
				})
				result := api.OnResolveResult{}
				if value, ok := response["error"]; ok {
					return result, errors.New(value.(string))
				}
				if value, ok := response["pluginName"]; ok {
					result.PluginName = value.(string)
				}
				if value, ok := response["path"]; ok {
					result.Path = value.(string)
				}
				if value, ok := response["namespace"]; ok {
					result.Namespace = value.(string)
				}
				if value, ok := response["suffix"]; ok {
					result.Suffix = value.(string)
				}
				if value, ok := response["external"]; ok {
					result.External = value.(bool)
				}
				if value, ok := response["sideEffects"]; ok {
					if value.(bool) {
						result.SideEffects = api.SideEffectsTrue
					} else {
						result.SideEffects = api.SideEffectsFalse
					}
				}
				if value, ok := response["pluginData"]; ok {
					result.PluginData = value.(int)
				}
				if value, ok := response["errors"]; ok {
					result.Errors = decodeMessages(value.([]interface{}))
				}
				if value, ok := response["warnings"]; ok {
					result.Warnings = decodeMessages(value.([]interface{}))
				}
				if value, ok := response["watchFiles"]; ok {
					result.WatchFiles = decodeStringArray(value.([]interface{}))
				}
				if value, ok := response["watchDirs"]; ok {
					result.WatchDirs = decodeStringArray(value.([]interface{}))
				}
				return result, nil
			})
			build.OnLoad(api.OnLoadOptions{Filter: ".*"}, func(args api.OnLoadArgs) (api.OnLoadResult, error) {
				result := api.OnLoadResult{}

				with := make(map[string]interface{}, len(args.With))
				for k, v := range args.With {
					with[k] = v
				}

				response := request("load", map[string]interface{}{
					"path":       args.Path,
					"namespace":  args.Namespace,
					"suffix":     args.Suffix,
					"pluginData": args.PluginData,
					"with":       with,
				})

				if value, ok := response["error"]; ok {
					return result, errors.New(value.(string))
				}
				if value, ok := response["pluginName"]; ok {
					result.PluginName = value.(string)
				}
				if value, ok := response["loader"]; ok {
					loader, _ := loaderMap[value.(string)]
					result.Loader = loader
				}
				if value, ok := response["contents"]; ok {
					contents := value.(string)
					result.Contents = &contents
				}
				if value, ok := response["resolveDir"]; ok {
					result.ResolveDir = value.(string)
				}
				if value, ok := response["pluginData"]; ok {
					result.PluginData = value.(int)
				}
				if value, ok := response["errors"]; ok {
					result.Errors = decodeMessages(value.([]interface{}))
				}
				if value, ok := response["warnings"]; ok {
					result.Warnings = decodeMessages(value.([]interface{}))
				}
				if value, ok := response["watchFiles"]; ok {
					result.WatchFiles = decodeStringArray(value.([]interface{}))
				}
				if value, ok := response["watchDirs"]; ok {
					result.WatchDirs = decodeStringArray(value.([]interface{}))
				}
				return result, nil
			})
			build.OnEnd(func(result *api.BuildResult) (api.OnEndResult, error) {
				req := map[string]interface{}{
					"errors":   encodeMessages(result.Errors),
					"warnings": encodeMessages(result.Warnings),
				}
				req["outputFiles"] = encodeOutputFiles(result.OutputFiles)
				req["metafile"] = result.Metafile
				req["mangleCache"] = result.MangleCache
				return api.OnEndResult{}, nil
			})
			build.OnDispose(func() {
				stdin.Close()
				stdout.Close()
				close(requests)
				close(responses)
				process.Kill(cmd.Process)
				wg.Wait()
			})
		},
	}
}

func encodeStringArray(strings []string) []interface{} {
	values := make([]interface{}, len(strings))
	for i, value := range strings {
		values[i] = value
	}
	return values
}

func decodeStringArray(values []interface{}) []string {
	strings := make([]string, len(values))
	for i, value := range values {
		strings[i] = value.(string)
	}
	return strings
}

func encodeOutputFiles(outputFiles []api.OutputFile) []interface{} {
	values := make([]interface{}, len(outputFiles))
	for i, outputFile := range outputFiles {
		values[i] = map[string]interface{}{
			"path":     outputFile.Path,
			"contents": outputFile.Contents,
			"hash":     outputFile.Hash,
		}
	}
	return values
}

func encodeLocation(loc *api.Location) interface{} {
	if loc == nil {
		return nil
	}
	return map[string]interface{}{
		"file":       loc.File,
		"namespace":  loc.Namespace,
		"line":       loc.Line,
		"column":     loc.Column,
		"length":     loc.Length,
		"lineText":   loc.LineText,
		"suggestion": loc.Suggestion,
	}
}

func encodeMessages(msgs []api.Message) []interface{} {
	values := make([]interface{}, len(msgs))
	for i, msg := range msgs {
		value := map[string]interface{}{
			"id":         msg.ID,
			"pluginName": msg.PluginName,
			"text":       msg.Text,
			"location":   encodeLocation(msg.Location),
		}
		values[i] = value

		notes := make([]interface{}, len(msg.Notes))
		for j, note := range msg.Notes {
			notes[j] = map[string]interface{}{
				"text":     note.Text,
				"location": encodeLocation(note.Location),
			}
		}
		value["notes"] = notes

		// Send "-1" to mean "undefined"
		detail, ok := msg.Detail.(int)
		if !ok {
			detail = -1
		}
		value["detail"] = detail
	}
	return values
}

func decodeLocation(value interface{}) *api.Location {
	if value == nil {
		return nil
	}
	loc := value.(map[string]interface{})
	namespace := loc["namespace"].(string)
	if namespace == "" {
		namespace = "file"
	}
	return &api.Location{
		File:       loc["file"].(string),
		Namespace:  namespace,
		Line:       loc["line"].(int),
		Column:     loc["column"].(int),
		Length:     loc["length"].(int),
		LineText:   loc["lineText"].(string),
		Suggestion: loc["suggestion"].(string),
	}
}

func decodeMessages(values []interface{}) []api.Message {
	msgs := make([]api.Message, len(values))
	for i, value := range values {
		obj := value.(map[string]interface{})
		msg := api.Message{
			ID:         obj["id"].(string),
			PluginName: obj["pluginName"].(string),
			Text:       obj["text"].(string),
			Location:   decodeLocation(obj["location"]),
			Detail:     obj["detail"].(int),
		}
		for _, note := range obj["notes"].([]interface{}) {
			noteObj := note.(map[string]interface{})
			msg.Notes = append(msg.Notes, api.Note{
				Text:     noteObj["text"].(string),
				Location: decodeLocation(noteObj["location"]),
			})
		}
		msgs[i] = msg
	}
	return msgs
}

func resolveKindToString(kind api.ResolveKind) string {
	switch kind {
	case api.ResolveEntryPoint:
		return "entry-point"

	// JS
	case api.ResolveJSImportStatement:
		return "import-statement"
	case api.ResolveJSRequireCall:
		return "require-call"
	case api.ResolveJSDynamicImport:
		return "dynamic-import"
	case api.ResolveJSRequireResolve:
		return "require-resolve"

	// CSS
	case api.ResolveCSSImportRule:
		return "import-rule"
	case api.ResolveCSSComposesFrom:
		return "composes-from"
	case api.ResolveCSSURLToken:
		return "url-token"

	default:
		panic("Internal error")
	}
}
