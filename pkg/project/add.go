package project

import (
	"os"
	"path/filepath"

	"github.com/sst/ion/pkg/global"
	"github.com/sst/ion/pkg/process"
)

func (p *Project) Add(pkg string, version string) error {
	cmd := process.Command(global.BunPath(), filepath.Join(p.PathPlatformDir(), "src/ast/add.ts"),
		p.PathConfig(),
		pkg,
		version,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
