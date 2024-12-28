package project

import (
	"github.com/sst/sst/v3/pkg/process"
	"os"
	"path/filepath"
)

func (p *Project) Add(pkg string, version string) error {
	cmd := process.Command("node", filepath.Join(p.PathPlatformDir(), "src/ast/add.mjs"),
		p.PathConfig(),
		pkg,
		version,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
