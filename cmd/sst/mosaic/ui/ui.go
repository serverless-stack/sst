package ui

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/pulumi/pulumi/sdk/v3/go/common/apitype"
	"github.com/pulumi/pulumi/sdk/v3/go/common/resource"
	"github.com/sst/sst/v3/cmd/sst/mosaic/aws"
	"github.com/sst/sst/v3/cmd/sst/mosaic/cloudflare"
	"github.com/sst/sst/v3/cmd/sst/mosaic/deployer"
	"github.com/sst/sst/v3/cmd/sst/mosaic/ui/common"
	"github.com/sst/sst/v3/pkg/project"

	"golang.org/x/crypto/ssh/terminal"
)

type ProgressMode string

var IGNORED_RESOURCES = []string{"sst:sst:Version", "sst:sst:LinkRef", "pulumi:pulumi:Stack"}

const (
	ProgressModeDeploy  ProgressMode = "deploy"
	ProgressModeRemove  ProgressMode = "remove"
	ProgressModeRefresh ProgressMode = "refresh"
	ProgressModeDiff    ProgressMode = "diff"
)

const (
	IconX     = "✕"
	IconCheck = "✓"
)

type UI struct {
	mode       ProgressMode
	dedupe     map[string]bool
	timing     map[string]time.Time
	parents    map[string]string
	colors     map[string]lipgloss.Style
	workerTime map[string]time.Time
	complete   *project.CompleteEvent
	footer     *footer
	buffer     []interface{}
	hasBlank   bool
	hasHeader  bool
	options    *Options
	log        *os.File
}

type Options struct {
	Silent bool
	Log    *os.File
	Dev    bool
}

type Option func(*Options)

func WithSilent(u *Options) {
	u.Silent = true
}

func WithDev(u *Options) {
	u.Dev = true
}

func WithLog(file *os.File) Option {
	return func(opts *Options) {
		opts.Log = file
	}
}

func New(ctx context.Context, options ...Option) *UI {
	opts := &Options{}
	for _, option := range options {
		option(opts)
	}
	isTTY := terminal.IsTerminal(int(os.Stdout.Fd()))
	slog.Info("initializing ui", "isTTY", isTTY)
	result := &UI{
		colors:     map[string]lipgloss.Style{},
		workerTime: map[string]time.Time{},
		hasBlank:   false,
		options:    opts,
	}
	if opts.Log != nil {
		result.log = opts.Log
	}
	if isTTY && !opts.Silent {
		result.footer = NewFooter()
		go result.footer.Start(ctx)
	}
	result.reset()
	return result
}

func (u *UI) print(args ...interface{}) {
	u.buffer = append(u.buffer, args...)
}

func (u *UI) printf(tmpl string, args ...interface{}) {
	u.buffer = append(u.buffer, fmt.Sprintf(tmpl, args...))
}

func (u *UI) println(args ...interface{}) {
	u.buffer = append(u.buffer, args...)
	line := fmt.Sprint(u.buffer...)
	if u.footer == nil {
		fmt.Println(line)
	}
	if u.footer != nil {
		u.footer.Send(lineMsg(line))
	}
	if u.log != nil {
		stripped := ansi.Strip(line)
		u.log.WriteString(stripped + "\n")
	}
	u.buffer = []interface{}{}
	u.hasBlank = false
}

func (u *UI) blank() {
	if u.hasBlank {
		return
	}
	u.println()
	u.hasBlank = true
}

func (u *UI) reset() {
	u.complete = nil
	u.parents = map[string]string{}
	u.dedupe = map[string]bool{}
	u.timing = map[string]time.Time{}
	u.buffer = []interface{}{}
}

func (u *UI) Event(unknown interface{}) {
	if u.footer != nil {
		defer u.footer.Send(unknown)
	}
	switch evt := unknown.(type) {

	case *common.StdoutEvent:
		u.println(evt.Line)

	case *aws.TaskProvisionEvent:
		u.printEvent(u.getColor(""), TEXT_NORMAL_BOLD.Render(fmt.Sprintf("%-11s", "Provision")), evt.Name)

	case *aws.TaskStartEvent:
		u.workerTime[evt.WorkerID] = time.Now()
		u.printEvent(u.getColor(evt.WorkerID), fmt.Sprintf("%-11s", "Start"), evt.Command)

	case *aws.TaskLogEvent:
		duration := time.Since(u.workerTime[evt.WorkerID]).Round(time.Millisecond)
		formattedDuration := fmt.Sprintf("%.9s", fmt.Sprintf("+%v", duration))
		u.printEvent(u.getColor(evt.WorkerID), formattedDuration, evt.Line)

	case *aws.TaskCompleteEvent:
		duration := time.Since(u.workerTime[evt.WorkerID]).Round(time.Millisecond)
		formattedDuration := fmt.Sprintf("took %.9s", fmt.Sprintf("+%v", duration))
		u.printEvent(u.getColor(evt.WorkerID), "Done", formattedDuration)

	case *aws.FunctionInvokedEvent:
		u.workerTime[evt.WorkerID] = time.Now()
		u.printEvent(u.getColor(evt.WorkerID), TEXT_NORMAL_BOLD.Render(fmt.Sprintf("%-11s", "Invoke")), u.functionName(evt.FunctionID))

	case *aws.FunctionResponseEvent:
		duration := time.Since(u.workerTime[evt.WorkerID]).Round(time.Millisecond)
		formattedDuration := fmt.Sprintf("took %.9s", fmt.Sprintf("+%v", duration))
		u.printEvent(u.getColor(evt.WorkerID), "Done", formattedDuration)

	case *aws.FunctionLogEvent:
		duration := time.Since(u.workerTime[evt.WorkerID]).Round(time.Millisecond)
		formattedDuration := fmt.Sprintf("%.9s", fmt.Sprintf("+%v", duration))
		u.printEvent(u.getColor(evt.WorkerID), formattedDuration, evt.Line)

	case *aws.FunctionBuildEvent:
		if len(evt.Errors) > 0 {
			u.printEvent(TEXT_DANGER, "Build Error", u.functionName(evt.FunctionID))
			for _, item := range evt.Errors {
				u.printEvent(TEXT_DANGER, "", "↳ "+strings.TrimSpace(item))
			}
			return
		}
		u.printEvent(TEXT_SUCCESS, "Build", u.functionName(evt.FunctionID))

	case *aws.FunctionErrorEvent:
		u.printEvent(u.getColor(evt.WorkerID), TEXT_DANGER.Render(fmt.Sprintf("%-11s", "Error")), u.functionName(evt.FunctionID))
		u.printEvent(u.getColor(evt.WorkerID), "", evt.ErrorMessage)
		for _, item := range evt.Trace {
			if strings.Contains(item, "Error:") {
				continue
			}
			u.printEvent(u.getColor(evt.WorkerID), "", "↳ "+strings.TrimSpace(item))
		}

	case *project.ConcurrentUpdateEvent:
		u.reset()
		u.printEvent(TEXT_DANGER, "Locked", "A concurrent update was detected on the app. Run `sst unlock` to remove the lock and try again.")

	case *deployer.DeployFailedEvent:
		u.reset()
		u.printEvent(TEXT_DANGER, "Error", evt.Error)

	case *project.StackCommandEvent:
		u.reset()
		u.header(evt.Version, evt.App, evt.Stage)
		u.blank()
		if evt.Command == "deploy" {
			u.mode = ProgressModeDeploy
			u.println(
				TEXT_WARNING_BOLD.Render("~"),
				TEXT_NORMAL_BOLD.Render("  Deploy"),
			)
		}
		if evt.Command == "remove" {
			u.mode = ProgressModeRemove
			u.println(
				TEXT_DANGER_BOLD.Render("~"),
				TEXT_NORMAL_BOLD.Render("  Remove"),
			)
		}
		if evt.Command == "refresh" {
			u.mode = ProgressModeRefresh
			u.println(
				TEXT_INFO_BOLD.Render("~"),
				TEXT_NORMAL_BOLD.Render("  Refresh"),
			)
		}
		if evt.Command == "diff" {
			u.mode = ProgressModeDiff
			u.println(
				TEXT_INFO_BOLD.Render("~"),
				TEXT_NORMAL_BOLD.Render("  Diff"),
			)
		}
		u.blank()

	case *project.BuildFailedEvent:
		u.reset()
		u.printEvent(TEXT_DANGER, "Error", evt.Error)

	case *apitype.ResourcePreEvent:
		u.timing[evt.Metadata.URN] = time.Now()
		if slices.Contains(IGNORED_RESOURCES, evt.Metadata.Type) {
			return
		}

		if evt.Metadata.Old != nil && evt.Metadata.Old.Parent != "" {
			u.parents[evt.Metadata.URN] = evt.Metadata.Old.Parent
		}

		if evt.Metadata.New != nil && evt.Metadata.New.Parent != "" {
			u.parents[evt.Metadata.URN] = evt.Metadata.New.Parent
		}

		if evt.Metadata.Op == apitype.OpSame {
			return
		}

	case *apitype.ResOpFailedEvent:
		break

	case *apitype.ResOutputsEvent:
		if slices.Contains(IGNORED_RESOURCES, evt.Metadata.Type) {
			return
		}

		duration := time.Since(u.timing[evt.Metadata.URN]).Round(time.Millisecond)
		if evt.Metadata.Op == apitype.OpSame && u.mode == ProgressModeRefresh {
			u.printProgress(
				TEXT_SUCCESS,
				"Refreshed",
				duration,
				evt.Metadata.URN,
			)
			return
		}
		if evt.Metadata.Op == apitype.OpImport {
			u.printProgress(
				TEXT_SUCCESS,
				"Imported",
				duration,
				evt.Metadata.URN,
			)
		}
		if evt.Metadata.Op == apitype.OpCreate {
			u.printProgress(
				TEXT_SUCCESS,
				"Created",
				duration,
				evt.Metadata.URN,
			)
		}
		if evt.Metadata.Op == apitype.OpUpdate {
			u.printProgress(
				TEXT_SUCCESS,
				"Updated",
				duration,
				evt.Metadata.URN,
			)
		}
		if evt.Metadata.Op == apitype.OpDelete {
			u.printProgress(
				TEXT_DIM,
				"Deleted",
				duration,
				evt.Metadata.URN,
			)
		}
		if evt.Metadata.Op == apitype.OpDeleteReplaced {
			u.printProgress(
				TEXT_DIM,
				"Deleted",
				duration,
				evt.Metadata.URN,
			)
		}
		if evt.Metadata.Op == apitype.OpCreateReplacement {
			u.printProgress(
				TEXT_SUCCESS,
				"Created",
				duration,
				evt.Metadata.URN,
			)
		}
		if evt.Metadata.Op == apitype.OpReplace {
		}

	case *apitype.DiagnosticEvent:
		if evt.Severity == "error" {
			message := []string{u.FormatURN(evt.URN)}
			message = append(message, parseError(evt.Message)...)
			u.printEvent(TEXT_DANGER, "Error", message...)
		}

		if evt.Severity == "info" {
			for _, line := range strings.Split(strings.TrimRightFunc(ansi.Strip(evt.Message), unicode.IsSpace), "\n") {
				u.println(TEXT_DIM.Render(line))
			}
		}

		if evt.Severity == "info#err" {
			u.println(strings.TrimRightFunc(ansi.Strip(evt.Message), unicode.IsSpace))
		}

	case *apitype.ProgressEvent:
		if evt.Done && evt.Type == apitype.PluginDownload {
			splits := strings.Split(evt.ID, ":")
			u.printEvent(TEXT_INFO, "Info", "Downloaded provider "+splits[1])
		}

	case *project.CompleteEvent:
		u.complete = evt
		if evt.Old {
			break
		}
		u.blank()
		if len(evt.Errors) == 0 && evt.Finished {
			u.print(TEXT_SUCCESS_BOLD.Render(IconCheck))
			if len(u.timing) == 0 {
				if u.mode == ProgressModeRemove {
					u.print(TEXT_NORMAL_BOLD.Render("  No resources to remove"))
				} else {
					u.print(TEXT_NORMAL_BOLD.Render("  No changes"))
				}
			}
			if len(u.timing) > 0 {
				label := ""
				if u.mode == ProgressModeRemove {
					label = "Removed"
				}
				if u.mode == ProgressModeDeploy {
					label = "Complete"
				}
				if u.mode == ProgressModeRefresh {
					label = "Refreshed"
				}
				if u.mode == ProgressModeDiff {
					label = "Generated"
				}
				u.print(TEXT_NORMAL_BOLD.Render("  " + label + "    "))
			}
			u.println()
			if len(evt.Hints) > 0 {
				for k, v := range evt.Hints {
					splits := strings.Split(k, "::")
					u.println(
						TEXT_DIM_BOLD.Render("   "),
						TEXT_DIM_BOLD.Render(splits[len(splits)-1]+": "),
						TEXT_NORMAL.Render(v),
					)
				}
			}
			if len(evt.Outputs) > 0 {
				if len(evt.Hints) > 0 {
					u.println(TEXT_DIM_BOLD.Render("   ---"))
				}
				for k, v := range evt.Outputs {
					u.println(
						TEXT_DIM_BOLD.Render("   "),
						TEXT_DIM_BOLD.Render(k+": "),
						TEXT_NORMAL.Render(fmt.Sprint(v)),
					)
				}
			}
		}
		if len(evt.Errors) == 0 && !evt.Finished {
			u.println(
				TEXT_DANGER_BOLD.Render(IconX),
				TEXT_NORMAL_BOLD.Render("  Interrupted    "),
			)
		}
		if len(evt.Errors) > 0 {
			u.println(
				TEXT_DANGER_BOLD.Render(IconX),
				TEXT_NORMAL_BOLD.Render("  Failed    "),
			)

			for _, status := range evt.Errors {
				if status.URN != "" {
					u.println(TEXT_DANGER_BOLD.Render("   " + u.FormatURN(status.URN)))
				}
				for _, line := range parseError(status.Message) {
					u.println(TEXT_NORMAL.Render("   " + line))
				}
				for i, line := range status.Help {
					if i == 0 {
						u.println()
					}
					u.println(TEXT_NORMAL.Render("   " + line))
				}
				importDiffs, ok := evt.ImportDiffs[status.URN]
				if ok {
					isSSTComponent := strings.Contains(status.URN, "::sst")
					if isSSTComponent {
						u.println(TEXT_NORMAL.Render("\n\nSet the following in your transform:"))
					}
					if !isSSTComponent {
						u.println(TEXT_NORMAL.Render("\n\nSet the following:"))
					}
					for _, diff := range importDiffs {
						value, _ := json.Marshal(diff.Old)
						if diff.Old == nil {
							value = []byte("undefined")
						}
						u.print(TEXT_NORMAL.Render("   - "))
						if isSSTComponent {
							u.print(TEXT_INFO.Render("`args." + string(diff.Input) + " = " + string(value) + ";`"))
						}
						if !isSSTComponent {
							u.print(TEXT_INFO.Render("`" + string(diff.Input) + ": " + string(value) + ",`"))
						}
						u.println()
					}
				} else {
					u.println()
				}
			}
		}
		u.blank()
	case *cloudflare.WorkerBuildEvent:
		if len(evt.Errors) > 0 {
			u.printEvent(TEXT_DANGER, "Build Error", u.functionName(evt.WorkerID)+" "+strings.Join(evt.Errors, "\n"))
			return
		}
		u.printEvent(TEXT_INFO, "Build", u.functionName(evt.WorkerID))
	case *cloudflare.WorkerUpdatedEvent:
		u.printEvent(TEXT_INFO, "Reload", u.functionName(evt.WorkerID))
	case *cloudflare.WorkerInvokedEvent:
		url, _ := url.Parse(evt.TailEvent.Event.Request.URL)
		u.printEvent(
			u.getColor(evt.WorkerID),
			TEXT_NORMAL_BOLD.Render(fmt.Sprintf("%-11s", "Invoke")),
			u.functionName(evt.WorkerID)+" "+evt.TailEvent.Event.Request.Method+" "+url.Path,
		)
		for _, log := range evt.TailEvent.Logs {
			duration := time.UnixMilli(log.Timestamp).Sub(time.UnixMilli(evt.TailEvent.EventTimestamp))
			formattedDuration := fmt.Sprintf("%.9s", fmt.Sprintf("+%v", duration))

			line := []string{}
			for _, part := range log.Message {
				switch v := part.(type) {
				case string:
					line = append(line, v)
				case map[string]interface{}:
					data, _ := json.Marshal(v)
					line = append(line, string(data))
				}
			}

			for _, item := range strings.Split(strings.Join(line, " "), "\n") {
				u.printEvent(u.getColor(evt.WorkerID), formattedDuration, item)
			}
		}
		u.printEvent(u.getColor(evt.WorkerID), "Done", evt.TailEvent.Outcome)
	}

}

var COLORS = []lipgloss.Style{
	lipgloss.NewStyle().Foreground(lipgloss.Color("13")),
	lipgloss.NewStyle().Foreground(lipgloss.Color("14")),
	lipgloss.NewStyle().Foreground(lipgloss.Color("2")),
	lipgloss.NewStyle().Foreground(lipgloss.Color("12")),
}

func (u *UI) getColor(input string) lipgloss.Style {
	result, ok := u.colors[input]
	if !ok {
		result = COLORS[len(u.colors)%len(COLORS)]
		u.colors[input] = result
	}
	return result
}

func (u *UI) functionName(functionID string) string {
	if u.complete == nil {
		return functionID
	}
	for _, resource := range u.complete.Resources {
		if resource.Type == "sst:aws:Function" && resource.URN.Name() == functionID {
			return resource.Outputs["_metadata"].(map[string]interface{})["handler"].(string)
		}
		if resource.Type == "sst:cloudflare:Worker" && resource.URN.Name() == functionID {
			return resource.Outputs["_metadata"].(map[string]interface{})["handler"].(string)
		}
	}
	return functionID
}

func (u *UI) printProgress(barColor lipgloss.Style, label string, duration time.Duration, urn string) {
	message := u.FormatURN(urn)
	if duration > time.Second {
		message += fmt.Sprintf(" (%.1fs)", duration.Seconds())
	}
	u.printEvent(barColor, label, message)
}

func (u *UI) printEvent(barColor lipgloss.Style, label string, message ...string) {
	u.print(barColor.Copy().Bold(true).Render("|  "))
	if label != "" {
		u.print(TEXT_DIM.Render(fmt.Sprint(fmt.Sprintf("%-11s", label), " ")))
	}
	if len(message) > 0 {
		u.print(TEXT_DIM.Render(message[0]))
	}
	u.println()
	for _, msg := range message[1:] {
		u.print(barColor.Copy().Bold(true).Render("|  "))
		u.println(TEXT_DIM.Render(msg))
	}
}

func (u *UI) Destroy() {
	if u.footer != nil {
		u.footer.Destroy()
	}
	if u.log != nil {
		u.log.Close()
	}
}

func (u *UI) header(version, app, stage string) {
	if u.hasHeader {
		return
	}
	u.println(
		TEXT_HIGHLIGHT_BOLD.Render("SST "+version),
		TEXT_DIM.Render("  ready!"),
	)
	u.blank()
	u.println(
		TEXT_HIGHLIGHT_BOLD.Render("➜  "),
		TEXT_NORMAL_BOLD.Render(fmt.Sprintf("%-12s", "App:")),
		TEXT_DIM.Render(app),
	)
	u.println(
		TEXT_NORMAL_BOLD.Render(fmt.Sprintf("   %-12s", "Stage:")),
		TEXT_DIM.Render(stage),
	)

	if u.options.Dev {
		u.println(
			TEXT_NORMAL_BOLD.Render(fmt.Sprintf("   %-12s", "Console:")),
			TEXT_DIM.Render("https://console.sst.dev/local/"+app+"/"+stage),
		)
	}
	u.blank()
	u.hasHeader = true
}

func (u *UI) FormatURN(urn string) string {
	if urn == "" {
		return ""
	}

	child := resource.URN(urn)
	name := child.Name()
	typeName := child.Type().DisplayName()
	splits := strings.SplitN(child.Name(), ".", 2)
	if len(splits) > 1 {
		name = splits[0]
		typeName = strings.ReplaceAll(splits[1], ".", ":")
	}
	result := name + " " + typeName

	for {
		parent := resource.URN(u.parents[string(child)])
		if parent == "" {
			break
		}
		if slices.Contains(IGNORED_RESOURCES, parent.Type().DisplayName()) {
			break
		}
		child = parent
	}
	if string(child) != urn {
		result = child.Name() + " " + child.Type().DisplayName() + " → " + result
	}
	return result
}

func Success(msg string) {
	fmt.Fprint(os.Stderr, strings.TrimSpace(TEXT_SUCCESS_BOLD.Render(IconCheck)+"  "+TEXT_NORMAL.Render(fmt.Sprintln(msg))))
}

func Error(msg string) {
	fmt.Fprint(os.Stderr, strings.TrimSpace(TEXT_DANGER_BOLD.Render(IconX)+"  "+TEXT_NORMAL.Render(fmt.Sprintln(msg))))
}
