package cli

import (
	"context"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strings"

	flag "github.com/spf13/pflag"
	"golang.org/x/term"

	"github.com/charmbracelet/huh"
	"github.com/fatih/color"
	"github.com/joho/godotenv"
	"github.com/sst/sst/v3/internal/util"
	"github.com/sst/sst/v3/pkg/project"
)

type Cli struct {
	version   string
	flags     map[string]interface{}
	arguments []string
	path      CommandPath
	Context   context.Context
	cancel    context.CancelFunc
	env       []string
}

func New(ctx context.Context, cancel context.CancelFunc, root *Command, version string) (*Cli, error) {
	env := os.Environ()
	godotenv.Load()
	parsedFlags := map[string]interface{}{}
	root.init(parsedFlags)
	flag.CommandLine.Init("sst", flag.ContinueOnError)
	cliParseError := flag.CommandLine.Parse(os.Args[1:])
	positionals := []string{}
	cmds := CommandPath{
		*root,
	}
	for i, arg := range flag.Args() {
		var cmd *Command

		last := cmds[len(cmds)-1]
		if len(last.Children) == 0 {
			positionals = flag.Args()[i:]
			break
		}
		for _, c := range last.Children {
			if c.Name == arg {
				cmd = c
				break
			}
		}
		if cmd == nil {
			break
		}
		cmds = append(cmds, *cmd)
	}
	cli := &Cli{
		flags:     parsedFlags,
		version:   version,
		arguments: positionals,
		path:      cmds,
		Context:   ctx,
		cancel:    cancel,
		env:       env,
	}
	cli.configureLog()
	if cliParseError != nil {
		return nil, cli.PrintHelp()
	}
	cli.configureLog()
	return cli, nil
}

func (c *Cli) Run() error {
	active := c.path[len(c.path)-1]
	required := 0
	for _, arg := range active.Args {
		if !arg.Required {
			continue
		}
		required += 1
	}
	if c.Bool("help") || active.Run == nil || len(c.arguments) < required {
		return c.PrintHelp()
	} else {
		return active.Run(c)
	}
}

func (c *Cli) Cancel() {
	c.cancel()
}

func (c *Cli) Path() CommandPath {
	return c.path
}

func (c *Cli) String(name string) string {
	if f, ok := c.flags[name]; ok {
		return *f.(*string)
	}
	return ""
}

func (c *Cli) Bool(name string) bool {
	if f, ok := c.flags[name]; ok {
		return *f.(*bool)
	}
	return false
}

func (c *Cli) PrintHelp() error {
	return c.path.PrintHelp()
}

func (c *Cli) Arguments() []string {
	return c.arguments
}

func (c *Cli) Positional(index int) string {
	if index >= len(c.arguments) {
		return ""
	}
	return c.arguments[index]
}

func (c *Cli) Env() []string {
	return c.env
}

type Command struct {
	Name        string               `json:"name"`
	Hidden      bool                 `json:"hidden"`
	Description Description          `json:"description"`
	Args        ArgumentList         `json:"args"`
	Flags       []Flag               `json:"flags"`
	Examples    []Example            `json:"examples"`
	Children    []*Command           `json:"children"`
	Run         func(cli *Cli) error `json:"-"`
}

func (c *Command) init(parsed map[string]interface{}) {
	if c.Args == nil {
		c.Args = ArgumentList{}
	}
	if c.Flags == nil {
		c.Flags = []Flag{}
	}
	if c.Examples == nil {
		c.Examples = []Example{}
	}
	if c.Children == nil {
		c.Children = []*Command{}
	}
	for _, f := range c.Flags {
		if parsed[f.Name] != nil {
			continue
		}
		if f.Type == "string" {
			parsed[f.Name] = flag.String(f.Name, "", "")
		}

		if f.Type == "bool" {
			parsed[f.Name] = flag.Bool(f.Name, false, "")
		}
	}
	for _, child := range c.Children {
		child.init(parsed)
	}
}

type Example struct {
	Content     string      `json:"content"`
	Description Description `json:"description"`
}

type Argument struct {
	Name        string      `json:"name"`
	Required    bool        `json:"required"`
	Description Description `json:"description"`
}

type Description struct {
	Short string `json:"short,omitempty"`
	Long  string `json:"long,omitempty"`
}

type ArgumentList []Argument

func (a ArgumentList) String() string {
	args := []string{}
	for _, arg := range a {
		if arg.Required {
			args = append(args, "<"+arg.Name+">")
		} else {
			args = append(args, "["+arg.Name+"]")
		}
	}
	return strings.Join(args, " ")
}

type Flag struct {
	Name        string      `json:"name"`
	Type        string      `json:"type"`
	Description Description `json:"description"`
}

type CommandPath []Command

var ErrHelp = util.NewReadableError(nil, "")

func (c CommandPath) PrintHelp() error {
	prefix := []string{}
	for _, cmd := range c {
		prefix = append(prefix, cmd.Name)
	}
	active := c[len(c)-1]

	if len(active.Children) > 0 {
		fmt.Print(strings.Join(prefix, " ") + ": ")
		fmt.Println(color.WhiteString(c[len(c)-1].Description.Short))

		maxSubcommand := 0
		for _, child := range active.Children {
			if child.Hidden {
				continue
			}
			next := len(child.Name)
			if len(child.Args) > 0 {
				next += len(child.Args.String()) + 1
			}
			if next > maxSubcommand {
				maxSubcommand = next
			}
		}

		fmt.Println()
		for _, child := range active.Children {
			if child.Hidden {
				continue
			}
			fmt.Printf(
				"  %s %s  %s\n",
				strings.Join(prefix, " "),
				color.New(color.FgWhite, color.Bold).Sprintf("%-*s", maxSubcommand, func() string {
					if len(child.Args) > 0 {
						return strings.Join([]string{child.Name, child.Args.String()}, " ")
					}
					return child.Name
				}()),
				child.Description.Short,
			)
		}
	}

	if len(active.Children) == 0 {
		color.New(color.FgWhite, color.Bold).Print("Usage: ")
		color.New(color.FgCyan).Print(strings.Join(prefix, " "))
		if len(active.Args) > 0 {
			color.New(color.FgGreen).Print(" " + active.Args.String())
		}
		fmt.Println()
		fmt.Println()

		color.New(color.FgWhite, color.Bold).Print("Flags:\n")
		maxFlag := 0
		for _, cmd := range c {
			for _, f := range cmd.Flags {
				l := len(f.Name) + 3
				if l > maxFlag {
					maxFlag = l
				}
			}
		}

		for _, cmd := range c {
			for _, f := range cmd.Flags {
				fmt.Printf(
					"  %s  %s\n",
					color.New(color.FgMagenta).Sprintf("--%-*s", maxFlag, f.Name),
					f.Description.Short,
				)
			}
		}

		if len(active.Examples) > 0 {
			fmt.Println()
			color.New(color.FgWhite, color.Bold).Print("Examples:\n")
			for _, example := range active.Examples {
				fmt.Println("  " + example.Content)
			}
		}
	}

	fmt.Println()
	fmt.Printf("Learn more at %s\n", color.MagentaString("https://sst.dev"))

	return ErrHelp
}

func (c *Cli) Stage(cfgPath string) (string, error) {
	stage := c.String("stage")
	if stage == "" {
		stage = os.Getenv("SST_STAGE")
		if stage == "" {
			stage = project.LoadPersonalStage(cfgPath)
			if stage == "" {
				stage = guessStage()
				if stage == "" {
					if !term.IsTerminal(int(os.Stdout.Fd())) {
						return "", util.NewReadableError(nil, "No stage specified. Pass it in with --stage or set the SST_STAGE environment variable. If this is a personal stage it can be set in `.sst/stage`.")
					}
					err := huh.NewForm(
						huh.NewGroup(
							huh.NewInput().Title(" Enter name for your personal stage").Prompt(" > ").Value(&stage).Validate(func(v string) error {
								if project.InvalidStageRegex.MatchString(v) {
									return fmt.Errorf("Invalid stage name")
								}
								return nil
							}),
						),
					).WithTheme(huh.ThemeCatppuccin()).Run()
					if err != nil {
						return "", err
					}
				}
				err := project.SetPersonalStage(cfgPath, stage)
				if err != nil {
					return "", err
				}
			}
		}
	}
	godotenv.Load(filepath.Join(filepath.Dir(cfgPath), ".env."+stage))
	return stage, nil
}

func guessStage() string {
	u, err := user.Current()
	if err != nil {
		return ""
	}
	stage := strings.ToLower(u.Username)
	stage = project.InvalidStageRegex.ReplaceAllString(stage, "")

	if stage == "root" || stage == "admin" || stage == "prod" || stage == "dev" || stage == "production" {
		return ""
	}
	return stage
}
