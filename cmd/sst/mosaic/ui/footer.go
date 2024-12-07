package ui

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/pulumi/pulumi/sdk/v3/go/common/apitype"
	"github.com/pulumi/pulumi/sdk/v3/go/common/resource"
	"github.com/sst/ion/cmd/sst/mosaic/deployer"
	"github.com/sst/ion/pkg/project"
	"golang.org/x/crypto/ssh/terminal"
)

type footer struct {
	started     bool
	mode        ProgressMode
	complete    *project.CompleteEvent
	parents     map[string]string
	summary     bool
	pending     []*apitype.ResourcePreEvent
	downloading map[string]*apitype.ProgressEvent
	skipped     int
	cancelled   bool

	spinner int

	input chan any

	previous string
}

type op struct {
	urn string
}

func NewFooter() *footer {
	f := footer{
		input: make(chan any),
	}
	f.Reset()
	return &f
}

func (m *footer) Send(input any) {
	m.input <- input
}

type spinnerTick struct{}

func (m *footer) Start(ctx context.Context) {
	ticker := time.NewTicker(time.Millisecond * 100)
	defer ticker.Stop()
	go func() {
		for range ticker.C {
			m.Send(&spinnerTick{})
		}
	}()
	os.Stdout.WriteString("\033[2l")
	os.Stdout.WriteString(ansi.HideCursor)
	for {
		select {
		case <-ctx.Done():
			m.cancelled = true
			break
		case val, ok := <-m.input:
			if !ok {
				return
			}
			width, _, _ := terminal.GetSize(int(os.Stdout.Fd()))
			switch evt := val.(type) {
			case lineMsg:
				m.clear()
				fmt.Println(evt)
			default:
				m.Update(val)
			}
			next := m.View(width)
			m.Render(width, next)
		}
	}
}

func (m *footer) clear() {
	oldLines := strings.Split(m.previous, "\n")
	out := &bytes.Buffer{}
	if len(oldLines) > 0 {
		for i := range oldLines {
			out.WriteString(ansi.EraseEntireLine)
			if i < len(oldLines)-1 {
				out.WriteString(ansi.CursorUp1)
			}
		}
	}
	os.Stdout.Write(out.Bytes())
	m.previous = ""
}

func (m *footer) Render(width int, next string) {
	oldLines := strings.Split(m.previous, "\n")
	nextLines := strings.Split(next, "\n")

	out := &bytes.Buffer{}

	// if next == m.previous {
	// 	return
	// }

	if len(oldLines) > 0 {
		for i := range oldLines {
			if i < len(oldLines)-len(nextLines) || next == "" {
				out.WriteString(ansi.EraseEntireLine)
			}
			if i < len(oldLines)-1 {
				out.WriteString(ansi.CursorUp1)
			}
		}
	}

	for i, line := range nextLines {
		if i == 0 {
			out.WriteByte('\r')
		}
		truncated := ansi.Truncate(line, width, "…")
		out.WriteString(truncated)
		out.WriteString(ansi.EraseLine(0))
		if i < len(nextLines)-1 {
			out.WriteString("\r\n")
		}
	}
	out.WriteString(ansi.CursorLeft(10000))
	os.Stdout.Write(out.Bytes())
	m.previous = next
}

func (m *footer) Reset() {
	m.started = false
	m.skipped = 0
	m.parents = map[string]string{}
	m.pending = []*apitype.ResourcePreEvent{}
	m.downloading = map[string]*apitype.ProgressEvent{}
	m.complete = nil
	m.summary = false
	m.cancelled = false
}

func (m *footer) Update(msg any) {
	switch msg := msg.(type) {
	case *spinnerTick:
		m.spinner++
	case *project.StackCommandEvent:
		m.Reset()
		m.started = true
		if msg.Command == "diff" {
			m.mode = ProgressModeDiff
		}
		if msg.Command == "refresh" {
			m.mode = ProgressModeRefresh
		}
		if msg.Command == "remove" {
			m.mode = ProgressModeRemove
		}
		if msg.Command == "deploy" {
			m.mode = ProgressModeDeploy
		}
	case *project.CompleteEvent:
		if msg.Old {
			break
		}
		m.complete = msg
	case *project.ConcurrentUpdateEvent:
		m.Reset()
		break
	case *deployer.DeployFailedEvent:
		m.Reset()
		break
	case *apitype.ResourcePreEvent:
		if slices.Contains(IGNORED_RESOURCES, msg.Metadata.Type) {
			break
		}
		if msg.Metadata.Old != nil && msg.Metadata.Old.Parent != "" {
			m.parents[msg.Metadata.URN] = msg.Metadata.Old.Parent
		}
		if msg.Metadata.New != nil && msg.Metadata.New.Parent != "" {
			m.parents[msg.Metadata.URN] = msg.Metadata.New.Parent
		}
		if msg.Metadata.Op == apitype.OpSame || msg.Metadata.Op == apitype.OpRead {
			m.skipped++
		}
		if msg.Metadata.Op != apitype.OpSame && msg.Metadata.Op != apitype.OpRead {
			m.pending = append(m.pending, msg)
		}
	case *apitype.ProgressEvent:
		if msg.Type == apitype.PluginDownload {
			m.downloading[msg.ID] = msg
		}
	case *apitype.SummaryEvent:
		m.summary = true
	case *apitype.ResOutputsEvent:
		m.removePending(msg.Metadata.URN)
	case *apitype.DiagnosticEvent:
		if msg.URN != "" {
			m.removePending(msg.URN)
		}
	}
}

func (m *footer) Destroy() {
	fmt.Print(ansi.ShowCursor)
}

var TEXT_HIGHLIGHT = lipgloss.NewStyle().Foreground(lipgloss.Color("14"))
var TEXT_HIGHLIGHT_BOLD = TEXT_HIGHLIGHT.Copy().Bold(true)

var TEXT_DIM = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
var TEXT_DIM_BOLD = TEXT_DIM.Copy().Bold(true)

var TEXT_NORMAL = lipgloss.NewStyle().Foreground(lipgloss.Color("15"))
var TEXT_NORMAL_BOLD = TEXT_NORMAL.Copy().Bold(true)

var TEXT_WARNING = lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
var TEXT_WARNING_BOLD = TEXT_WARNING.Copy().Bold(true)

var TEXT_DANGER = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))
var TEXT_DANGER_BOLD = TEXT_DANGER.Copy().Bold(true)

var TEXT_SUCCESS = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
var TEXT_SUCCESS_BOLD = TEXT_SUCCESS.Copy().Bold(true)

var TEXT_INFO = lipgloss.NewStyle().Foreground(lipgloss.Color("4"))
var TEXT_INFO_BOLD = TEXT_INFO.Copy().Bold(true)

func (m *footer) View(width int) string {
	if !m.started || m.complete != nil {
		return ""
	}
	spinner := spinner.MiniDot.Frames[m.spinner%len(spinner.MiniDot.Frames)]
	result := []string{}
	keys := make([]string, 0, len(m.downloading))
	for k := range m.downloading {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, key := range keys {
		progress := m.downloading[key]
		if progress.Done {
			continue
		}
		splits := strings.Split(progress.ID, ":")
		percentage := int(float64(progress.Completed) / float64(progress.Total) * 100)
		result = append(result, fmt.Sprintf("%s  %-11s %s %d%%", spinner, "Downloading", splits[1], percentage))
	}
	for _, r := range m.pending {
		label := "Creating"
		if r.Metadata.Op == apitype.OpUpdate {
			label = "Updating"
		}
		if r.Metadata.Op == apitype.OpDelete {
			label = "Deleting"
		}
		if r.Metadata.Op == apitype.OpReplace {
			label = "Creating"
		}
		if r.Metadata.Op == apitype.OpRefresh {
			label = "Refreshing"
		}
		if r.Metadata.Op == apitype.OpCreate {
			label = "Creating"
		}
		result = append(result, fmt.Sprintf("%s  %-11s %s", spinner, label, m.formatURN(r.Metadata.URN)))
	}
	label := "Finalizing"
	if !m.summary {
		if m.mode == ProgressModeDiff {
			label = "Generating"
		}
		if m.mode == ProgressModeRemove {
			label = "Removing"
		}
		if m.mode == ProgressModeRefresh {
			label = "Refreshing"
		}
		if m.mode == ProgressModeDeploy {
			label = "Deploying"
		}
		if m.cancelled {
			label = "Cancelling, waiting for pending operations to complete"
		}
	}
	if m.skipped > 0 {
		label = fmt.Sprintf("%-11s", label)
		label += TEXT_DIM.Render(fmt.Sprintf(" %d skipped", m.skipped))
	}
	result = append(result, spinner+"  "+label)
	return lipgloss.NewStyle().MaxWidth(width).Render(lipgloss.JoinVertical(lipgloss.Top, result...))
}

func (u *footer) removePending(urn string) {
	next := []*apitype.ResourcePreEvent{}
	for _, r := range u.pending {
		if r.Metadata.URN == urn {
			continue
		}
		next = append(next, r)
	}
	u.pending = next
}

func (u *footer) formatURN(urn string) string {
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
		if parent.Type().DisplayName() == "pulumi:pulumi:Stack" {
			break
		}
		child = parent
	}
	if string(child) != urn {
		result = child.Name() + " " + child.Type().DisplayName() + " → " + result
	}
	return result
}

type lineMsg = string
